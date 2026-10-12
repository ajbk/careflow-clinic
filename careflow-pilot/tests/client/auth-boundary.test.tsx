import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it } from "vitest";
import { AuthProvider, useAuth } from "../../src/client/auth/AuthProvider";
import { ApiClient } from "../../src/client/lib/api-client";

function ProtectedDraft() {
  const { session } = useAuth();
  const [draft, setDraft] = useState("");
  return session ? <input aria-label="unsent draft" value={draft} onChange={(event) => setDraft(event.target.value)} /> : null;
}
afterEach(() => { cleanup(); sessionStorage.clear(); new ApiClient().setSecurity(undefined); });
it.each(["actor", "role", "generation"])("remounts protected forms and clears cache when %s changes without a 401", async (change) => {
  const original = { user: { id: "actor-1", username: "doctor", displayName: "แพทย์ทดสอบ", role: "doctor" }, clinic: { id: "clinic", name: "synthetic" }, permissions: ["patient:read"],
    pilotAcknowledgedAt: new Date().toISOString(), mustChangePassword: false, idleExpiresAt: new Date(Date.now() + 3600000).toISOString(), security: { csrfToken: "a".repeat(64), generation: "original-generation" } };
  const updated = { ...original, user: { ...original.user, ...(change === "actor" ? { id: "actor-2" } : {}), ...(change === "role" ? { role: "assistant" } : {}) },
    security: { ...original.security, ...(change === "generation" ? { generation: "recovered-generation" } : {}) } };
  let switched = false;
  const apiClient = new ApiClient(async () => new Response(JSON.stringify({ data: switched ? updated : original }), { status: 200 }));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={["/queue"]}><AuthProvider apiClient={apiClient}><ProtectedDraft /></AuthProvider></MemoryRouter></QueryClientProvider>);
  const input = await screen.findByLabelText("unsent draft");
  await userEvent.setup().type(input, "private unsent old context");
  queryClient.setQueryData(["protected-test"], { private: "old context" });
  switched = true;
  await queryClient.invalidateQueries({ queryKey: ["session"] });
  await waitFor(() => expect(screen.getByLabelText("unsent draft")).toHaveValue(""));
  expect(queryClient.getQueryData(["protected-test"])).toBeUndefined();
});
