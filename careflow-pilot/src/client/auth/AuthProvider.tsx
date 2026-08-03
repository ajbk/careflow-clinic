import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { SessionDto } from "../../shared/contracts";
import { sessionResponseSchema } from "../../shared/contracts";
import { queryKeys } from "../app/query-client";
import { apiClient as defaultApiClient, ApiClient } from "../lib/api-client";
import { ApiError, isApiError, serverUnavailableError } from "../lib/api-error";

export interface ActivityAdapter {
  subscribe(listener: () => void): () => void;
}

const activityEvents = ["keydown", "pointerdown", "touchstart"] as const;

export function createBrowserActivityAdapter(target: Document = document): ActivityAdapter {
  return {
    subscribe(listener) {
      for (const eventName of activityEvents) target.addEventListener(eventName, listener, { passive: true });
      return () => {
        for (const eventName of activityEvents) target.removeEventListener(eventName, listener);
      };
    },
  };
}

const defaultActivityAdapter: ActivityAdapter | null =
  typeof document === "undefined" ? null : createBrowserActivityAdapter(document);

export function sanitizeReturnTo(value: string | null | undefined): string {
  if (!value) return "/";
  const decoded = value.trim();
  if (!decoded.startsWith("/") || decoded.startsWith("//") || decoded.startsWith("/\\")) return "/";
  if (/^[a-z][a-z\d+.-]*:/i.test(decoded)) return "/";
  return decoded;
}

interface AuthContextValue {
  session: SessionDto | null;
  isLoading: boolean;
  error: ApiError | null;
  apiClient: ApiClient;
  login(input: { username: string; password: string }): Promise<SessionDto>;
  acknowledgePilot(): Promise<void>;
  changePassword(input: { currentPassword: string; newPassword: string }): Promise<void>;
  logout(): Promise<void>;
  recordActivity(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

export function AuthProvider({
  children,
  apiClient = defaultApiClient,
  activityAdapter = defaultActivityAdapter ?? undefined,
}: {
  children: ReactNode;
  apiClient?: ApiClient;
  activityAdapter?: ActivityAdapter;
}): ReactElement {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const lastActivityAt = useRef<number>(Number.NEGATIVE_INFINITY);

  const sessionQuery = useQuery({
    queryKey: queryKeys.session,
    enabled: location.pathname !== "/login",
    queryFn: async ({ signal }): Promise<SessionDto | null> => {
      try {
        return (await apiClient.get("/api/auth/session", sessionResponseSchema, signal)).data;
      } catch (error) {
        if (isApiError(error) && error.status === 401) return null;
        throw error;
      }
    },
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const session = sessionQuery.data ?? null;

  const clearProtectedQueries = useCallback(() => {
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== queryKeys.session[0] });
  }, [queryClient]);

  const goToLogin = useCallback(() => {
    clearProtectedQueries();
    queryClient.setQueryData<SessionDto | null>(queryKeys.session, null);
    if (location.pathname !== "/login") {
      const returnTo = sanitizeReturnTo(`${location.pathname}${location.search}`);
      navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`, { replace: true });
    }
  }, [clearProtectedQueries, location.pathname, location.search, navigate, queryClient]);

  useEffect(() => {
    const listener = () => goToLogin();
    window.addEventListener("careflow-auth-required", listener);
    return () => window.removeEventListener("careflow-auth-required", listener);
  }, [goToLogin]);

  useEffect(() => {
    if (!session) return undefined;
    const expiresIn = Date.parse(session.idleExpiresAt) - Date.now();
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
      goToLogin();
      return undefined;
    }
    const timer = window.setTimeout(goToLogin, expiresIn);
    return () => window.clearTimeout(timer);
  }, [goToLogin, session]);

  const recordActivity = useCallback(() => {
    if (!session) return;
    const now = Date.now();
    if (now - lastActivityAt.current < 60_000) return;
    lastActivityAt.current = now;
    void apiClient.void("POST", "/api/auth/activity").catch((error: unknown) => {
      if (isApiError(error) && error.status === 401) goToLogin();
    });
  }, [apiClient, goToLogin, session]);

  useEffect(() => {
    if (!activityAdapter || !session) return undefined;
    return activityAdapter.subscribe(recordActivity);
  }, [activityAdapter, recordActivity, session]);

  const login = useCallback(
    async (input: { username: string; password: string }): Promise<SessionDto> => {
      const result = await apiClient.json("POST", "/api/auth/login", input, sessionResponseSchema);
      queryClient.setQueryData(queryKeys.session, result.data);
      return result.data;
    },
    [apiClient, queryClient],
  );

  const acknowledgePilot = useCallback(async () => {
    await apiClient.void("POST", "/api/auth/acknowledge-pilot", { accepted: true });
    const current = queryClient.getQueryData<SessionDto>(queryKeys.session);
    if (current) {
      queryClient.setQueryData<SessionDto>(queryKeys.session, {
        ...current,
        pilotAcknowledgedAt: new Date().toISOString(),
      });
    }
  }, [apiClient, queryClient]);

  const changePassword = useCallback(
    async (input: { currentPassword: string; newPassword: string }) => {
      await apiClient.void("POST", "/api/auth/change-password", input);
      const current = queryClient.getQueryData<SessionDto>(queryKeys.session);
      if (current) queryClient.setQueryData<SessionDto>(queryKeys.session, { ...current, mustChangePassword: false });
    },
    [apiClient, queryClient],
  );

  const logout = useCallback(async () => {
    try {
      await apiClient.void("POST", "/api/auth/logout");
    } catch {
      // A failed logout cannot keep protected data visible in this browser.
    } finally {
      clearProtectedQueries();
      queryClient.setQueryData<SessionDto | null>(queryKeys.session, null);
      navigate("/login", { replace: true });
    }
  }, [apiClient, clearProtectedQueries, navigate, queryClient]);

  const error = sessionQuery.error
    ? isApiError(sessionQuery.error)
      ? sessionQuery.error
      : serverUnavailableError(sessionQuery.error)
    : null;
  const contextValue = useMemo<AuthContextValue>(
    () => ({
      session,
      isLoading: sessionQuery.isPending && location.pathname !== "/login",
      error,
      apiClient,
      login,
      acknowledgePilot,
      changePassword,
      logout,
      recordActivity,
    }),
    [acknowledgePilot, apiClient, changePassword, error, location.pathname, login, logout, recordActivity, session, sessionQuery.isPending],
  );

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
}
