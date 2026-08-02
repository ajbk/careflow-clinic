"use client";

import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useRef,
  type Dispatch,
  type ReactNode,
} from "react";
import { careFlowReducer } from "./reducer";
import { createSeedState } from "./seed";
import { loadState, saveState } from "./storage";
import type { CareFlowAction, CareFlowState } from "./types";

interface CareFlowContextValue {
  state: CareFlowState;
  dispatch: Dispatch<CareFlowAction>;
}

const CareFlowContext = createContext<CareFlowContextValue | null>(null);

export function CareFlowProvider({
  children,
  initialState,
  persist = true,
}: {
  children: ReactNode;
  initialState?: CareFlowState;
  persist?: boolean;
}) {
  const [state, dispatch] = useReducer(careFlowReducer, initialState ?? createSeedState());
  const hydrated = useRef(Boolean(initialState) || !persist);

  useEffect(() => {
    if (!persist || initialState) return;
    dispatch({ type: "HYDRATE", payload: { state: loadState(window.localStorage) } });
    hydrated.current = true;
  }, [initialState, persist]);

  useEffect(() => {
    if (!persist || !hydrated.current) return;
    saveState(window.localStorage, state);
  }, [persist, state]);

  return <CareFlowContext.Provider value={{ state, dispatch }}>{children}</CareFlowContext.Provider>;
}

export function useCareFlow(): CareFlowContextValue {
  const context = useContext(CareFlowContext);
  if (!context) throw new Error("useCareFlow must be used inside CareFlowProvider");
  return context;
}
