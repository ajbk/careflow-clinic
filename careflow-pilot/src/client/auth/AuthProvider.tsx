import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { SessionDto } from "../../shared/contracts";
import { sessionResponseSchema } from "../../shared/contracts";
import { authRequiredEventName, queryKeys, type AuthRequiredReason } from "../app/query-client";
import { apiClient as defaultApiClient, ApiClient } from "../lib/api-client";
import { ApiError, isApiError, serverUnavailableError } from "../lib/api-error";

export interface ActivityAdapter {
  subscribe(listener: () => void): () => void;
}

const activityEvents = ["keydown", "pointerdown", "touchstart"] as const;

export function createBrowserActivityAdapter(target: Document = document): ActivityAdapter {
  return {
    subscribe(listener) {
      const trustedListener = (event: Event): void => {
        if (event.isTrusted) listener();
      };
      for (const eventName of activityEvents) target.addEventListener(eventName, trustedListener, { passive: true });
      return () => {
        for (const eventName of activityEvents) target.removeEventListener(eventName, trustedListener);
      };
    },
  };
}

const defaultActivityAdapter: ActivityAdapter | null =
  typeof document === "undefined" ? null : createBrowserActivityAdapter(document);

export type SessionReturnState = { authNotice?: "SESSION_EXPIRED" };

function dispatchAuthRequired(reason: AuthRequiredReason): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<{ reason: AuthRequiredReason }>(authRequiredEventName, { detail: { reason } }));
  }
}

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
  unauthorizedReason: AuthRequiredReason | null;
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
  const expiryTimer = useRef<number | undefined>(undefined);
  const establishedSession = useRef(false);
  const [unauthorizedReason, setUnauthorizedReason] = useState<AuthRequiredReason | null>(null);

  const sessionQuery = useQuery({
    queryKey: queryKeys.session,
    enabled: location.pathname !== "/login",
    queryFn: async ({ signal }): Promise<SessionDto | null> => {
      try {
        const current = (await apiClient.get("/api/auth/session", sessionResponseSchema, signal)).data;
        establishedSession.current = true;
        setUnauthorizedReason(null);
        return current;
      } catch (error) {
        if (isApiError(error) && error.status === 401) {
          const reason = error.code === "SESSION_EXPIRED" || establishedSession.current
            ? "SESSION_EXPIRED"
            : "AUTH_REQUIRED";
          setUnauthorizedReason(reason);
          dispatchAuthRequired(reason);
          return null;
        }
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

  const goToLogin = useCallback((reason: AuthRequiredReason = "AUTH_REQUIRED") => {
    const sessionExpired = reason === "SESSION_EXPIRED" || establishedSession.current;
    setUnauthorizedReason(sessionExpired ? "SESSION_EXPIRED" : reason);
    clearProtectedQueries();
    queryClient.setQueryData<SessionDto | null>(queryKeys.session, null);
    if (location.pathname !== "/login") {
      const returnTo = sanitizeReturnTo(`${location.pathname}${location.search}`);
      const search = sessionExpired
        ? `?returnTo=${encodeURIComponent(returnTo)}&reason=session-expired`
        : `?returnTo=${encodeURIComponent(returnTo)}`;
      navigate(`/login${search}`, { replace: true });
    }
  }, [clearProtectedQueries, location.pathname, location.search, navigate, queryClient]);

  useEffect(() => {
    const listener = (event: Event) => {
      const reason = event instanceof CustomEvent && event.detail?.reason === "SESSION_EXPIRED"
        ? "SESSION_EXPIRED"
        : "AUTH_REQUIRED";
      if (reason === "AUTH_REQUIRED" && sessionQuery.isPending && !establishedSession.current) return;
      goToLogin(reason);
    };
    window.addEventListener(authRequiredEventName, listener);
    return () => window.removeEventListener(authRequiredEventName, listener);
  }, [goToLogin, sessionQuery.isPending]);

  useEffect(() => {
    if (expiryTimer.current !== undefined) window.clearTimeout(expiryTimer.current);
    expiryTimer.current = undefined;
    if (!session) return undefined;
    const expiresIn = Date.parse(session.idleExpiresAt) - Date.now();
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
      const immediateExpiryTimer = window.setTimeout(() => goToLogin("SESSION_EXPIRED"), 0);
      return () => window.clearTimeout(immediateExpiryTimer);
    }
    expiryTimer.current = window.setTimeout(goToLogin, expiresIn);
    return () => {
      if (expiryTimer.current !== undefined) window.clearTimeout(expiryTimer.current);
      expiryTimer.current = undefined;
    };
  }, [goToLogin, session]);

  const recordActivity = useCallback(() => {
    if (!session) return;
    const now = Date.now();
    if (now - lastActivityAt.current < 60_000) return;
    lastActivityAt.current = now;
    void apiClient
      .void("POST", "/api/auth/activity")
      .then(() => queryClient.invalidateQueries({ queryKey: queryKeys.session }))
      .catch((error: unknown) => {
        if (isApiError(error) && error.status === 401) goToLogin("SESSION_EXPIRED");
      });
  }, [apiClient, goToLogin, queryClient, session]);

  useEffect(() => {
    if (!activityAdapter || !session) return undefined;
    return activityAdapter.subscribe(recordActivity);
  }, [activityAdapter, recordActivity, session]);

  const login = useCallback(
    async (input: { username: string; password: string }): Promise<SessionDto> => {
      const result = await apiClient.json("POST", "/api/auth/login", input, sessionResponseSchema);
      establishedSession.current = true;
      setUnauthorizedReason(null);
      clearProtectedQueries();
      queryClient.setQueryData(queryKeys.session, result.data);
      return result.data;
    },
    [apiClient, clearProtectedQueries, queryClient],
  );

  const acknowledgePilot = useCallback(async () => {
    await apiClient.void("POST", "/api/auth/acknowledge-pilot", { accepted: true });
    await queryClient.invalidateQueries({ queryKey: queryKeys.session });
  }, [apiClient, queryClient]);

  const changePassword = useCallback(
    async (input: { currentPassword: string; newPassword: string }) => {
      await apiClient.void("POST", "/api/auth/change-password", input);
      await queryClient.invalidateQueries({ queryKey: queryKeys.session });
    },
    [apiClient, queryClient],
  );

  const logout = useCallback(async () => {
    try {
      await apiClient.void("POST", "/api/auth/logout");
    } catch {
      // A failed logout cannot keep protected data visible in this browser.
    } finally {
      establishedSession.current = false;
      setUnauthorizedReason(null);
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
      unauthorizedReason: session ? null : unauthorizedReason,
      apiClient,
      login,
      acknowledgePilot,
      changePassword,
      logout,
      recordActivity,
    }),
    [acknowledgePilot, apiClient, changePassword, error, location.pathname, login, logout, recordActivity, session, sessionQuery.isPending, unauthorizedReason],
  );

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
}
