export type ExecutionGate = "fair" | "caution" | "overpay" | "halted" | "unavailable";

export interface GateInput {
  premiumPct: number | null;
  maxFillableUsd: number | null;
  notionalUsd: number;
  halted: boolean;
}

export interface GateDecision {
  gate: ExecutionGate;
  reason: string;
  exceedsDepth: boolean;
}

export function decideExecutionGate(input: GateInput): GateDecision {
  if (input.halted) {
    return {
      gate: "halted",
      reason: "Issuer trading is halted for this ticker.",
      exceedsDepth: false,
    };
  }

  if (input.premiumPct === null) {
    return {
      gate: "unavailable",
      reason: "A live premium cannot be measured.",
      exceedsDepth: false,
    };
  }

  if (input.maxFillableUsd === null) {
    return {
      gate: "unavailable",
      reason: "Route depth has not been measured.",
      exceedsDepth: false,
    };
  }

  const exceedsDepth = input.notionalUsd > input.maxFillableUsd;
  if (exceedsDepth) {
    return {
      gate: "overpay",
      reason: `The order is larger than the measured 1% depth of $${Math.round(input.maxFillableUsd).toLocaleString("en-US")}.`,
      exceedsDepth: true,
    };
  }

  const absolutePremium = Math.abs(input.premiumPct);
  if (absolutePremium > 2) {
    return {
      gate: "overpay",
      reason: "The token is more than 2% away from its reference price.",
      exceedsDepth: false,
    };
  }

  const usesMostDepth = input.notionalUsd >= input.maxFillableUsd * 0.6;
  if (absolutePremium >= 0.5 || usesMostDepth) {
    return {
      gate: "caution",
      reason: usesMostDepth
        ? "The order uses at least 60% of the measured route depth."
        : "The token is between 0.5% and 2% away from its reference price.",
      exceedsDepth: false,
    };
  }

  return {
    gate: "fair",
    reason: "Premium is under 0.5% and the order fits inside measured depth.",
    exceedsDepth: false,
  };
}
