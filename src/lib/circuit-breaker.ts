// An upstream that hangs is far more expensive than one that refuses: every
// caller pays the full request timeout before falling back. The xStocks issuer
// quote endpoint has done exactly that, costing ~8s on each of 33 symbols.
// After enough consecutive failures a breaker opens and callers fail fast,
// then one trial request per cooldown decides whether to close it again.

const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 5 * 60_000;

interface BreakerState {
  consecutiveFailures: number;
  openedAt: number | null;
  trialInFlight: boolean;
}

declare global {
  var fairPrintBreakers: Map<string, BreakerState> | undefined;
}

const breakers = globalThis.fairPrintBreakers ?? new Map<string, BreakerState>();
if (process.env.NODE_ENV !== "production") globalThis.fairPrintBreakers = breakers;

export class CircuitOpenError extends Error {
  constructor(name: string) {
    super(`${name} is failing and was skipped to avoid a slow retry`);
  }
}

function stateFor(name: string): BreakerState {
  const existing = breakers.get(name);
  if (existing) return existing;
  const created: BreakerState = {
    consecutiveFailures: 0,
    openedAt: null,
    trialInFlight: false,
  };
  breakers.set(name, created);
  return created;
}

/**
 * Runs `operation` unless `name` is currently breaking, in which case it
 * rejects immediately with CircuitOpenError instead of waiting on a timeout.
 */
export async function withBreaker<T>(name: string, operation: () => Promise<T>): Promise<T> {
  const state = stateFor(name);

  if (state.openedAt !== null) {
    const cooledDown = Date.now() - state.openedAt >= COOLDOWN_MS;
    // While open, let a single trial through per cooldown and fail the rest
    // fast, so a recovered upstream is noticed without a thundering herd.
    if (!cooledDown || state.trialInFlight) {
      throw new CircuitOpenError(name);
    }
    state.trialInFlight = true;
  }

  try {
    const result = await operation();
    state.consecutiveFailures = 0;
    state.openedAt = null;
    state.trialInFlight = false;
    return result;
  } catch (error) {
    state.trialInFlight = false;
    state.consecutiveFailures += 1;
    if (state.consecutiveFailures >= FAILURE_THRESHOLD) {
      const reopened = state.openedAt === null;
      state.openedAt = Date.now();
      if (reopened) {
        console.warn("[FairPrint] Circuit opened for a failing upstream", {
          upstream: name,
          consecutiveFailures: state.consecutiveFailures,
          cooldownMs: COOLDOWN_MS,
        });
      }
    }
    throw error;
  }
}

export function breakerIsOpen(name: string): boolean {
  const state = breakers.get(name);
  return state?.openedAt !== null && state?.openedAt !== undefined;
}
