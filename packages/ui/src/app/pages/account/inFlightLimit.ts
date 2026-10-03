import type { InFlightLimit } from "@clockwyrks/run-record/coverage";

// The runs-in-flight limit as the console handles it: the tagged shape the backend
// stores and reports, plus the few readings every surface that shows one needs. One
// home so the plan dashboard, the ladder dashboard, the two editors and the Runs
// settings tab all describe the same limit the same way.
//
// The limit caps how many of one plan's or one ladder dispatch's runs may be queued,
// pending, dispatched, starting or running at once. Completed runs never count,
// reviewed or not: it exists to share the one global queue fairly, not to pace
// reviewing.

/** The largest bound the backend stores; a bigger one is clamped on save. */
export const IN_FLIGHT_LIMIT_CEILING = 500;

/** The bound the backend applies to an account that has never chosen one. */
export const DEFAULT_IN_FLIGHT_LIMIT: InFlightLimit = {
  kind: "bounded",
  runs: 10,
};

/** No bound at all: a launch pass launches every missing cell at once. */
export const UNBOUNDED_LIMIT: InFlightLimit = { kind: "unbounded" };

/** A bound of `runs` runs in flight, kept within what the backend stores. */
export function boundedLimit(runs: number): InFlightLimit {
  const whole = Math.floor(runs);
  return {
    kind: "bounded",
    runs: Number.isFinite(whole)
      ? Math.min(Math.max(whole, 0), IN_FLIGHT_LIMIT_CEILING)
      : 0,
  };
}

/** The bound a limit carries, or null when it has none. */
export function limitBound(limit: InFlightLimit): number | null {
  return limit.kind === "bounded" ? limit.runs : null;
}

/**
 * Whether `inFlight` runs already reach the limit, so a launch pass launches nothing
 * more. The rule the backend applies: an unbounded limit is never reached.
 */
export function limitIsFull(limit: InFlightLimit, inFlight: number): boolean {
  return limit.kind === "bounded" && inFlight >= limit.runs;
}

/** Whether the limit is a bound of 0, under which a launch pass launches nothing. */
export function limitLaunchesNothing(limit: InFlightLimit): boolean {
  return limit.kind === "bounded" && limit.runs === 0;
}

export function sameInFlightLimit(
  a: InFlightLimit | null,
  b: InFlightLimit | null,
): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind) return false;
  return a.kind === "unbounded" || b.kind === "unbounded" || a.runs === b.runs;
}

/** The limit as the figure beside an occupancy: `4/10`, or `12/∞` with no limit. */
export function formatInFlightLimit(limit: InFlightLimit): string {
  return limit.kind === "bounded" ? String(limit.runs) : "∞";
}

/** The limit as a phrase: "10 runs in flight", "1 run in flight", "no limit". */
export function describeInFlightLimit(limit: InFlightLimit): string {
  if (limit.kind === "unbounded") return "no limit";
  return `${limit.runs} run${limit.runs === 1 ? "" : "s"} in flight`;
}

/**
 * The tooltip over a dashboard's `inFlight/limit` figure: what counts, and what the
 * limit does for the shape it has. `owner` names the surface ("plan", "ladder").
 */
export function inFlightStatTitle(
  limit: InFlightLimit,
  owner: "plan" | "ladder",
): string {
  const beyond =
    owner === "plan"
      ? " A job still counts here when other runs have filled its cell meanwhile, though its run will not be one of the plan's."
      : "";
  const occupancy = `Runs this ${owner} launched that are queued, pending, dispatched, starting, or running. Completed runs never count, reviewed or not.${beyond}`;
  const more = owner === "plan" ? "fills on" : "climbs on";
  return limit.kind === "bounded"
    ? `${occupancy} Nothing more is launched once this reaches the limit; the ${owner} ${more} as these finish.`
    : `${occupancy} This ${owner} has no limit, so everything it can launch is launched at once.`;
}
