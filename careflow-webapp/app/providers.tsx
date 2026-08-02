"use client";

import type { ReactNode } from "react";
import { CareFlowProvider } from "@/lib/careflow/context";

export function Providers({ children }: { children: ReactNode }) {
  return <CareFlowProvider>{children}</CareFlowProvider>;
}
