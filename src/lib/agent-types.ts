import type { AgentCheck } from "./agent-check";
import type { AgentTokenReport } from "./agent-token";

export type { AgentCheck };

export type AgentStatusResponse =
  | { configured: false; quoteSymbol: string }
  | ({ configured: true } & AgentTokenReport);
