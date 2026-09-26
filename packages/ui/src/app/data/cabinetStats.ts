// The static site's `GET /stats/cabinet` stand-in: a pure fold over the
// snapshot's inlined summary index, mirroring the backend's
// `fold_cabinet_stats` (crates/backend/src/stats.rs) so the home page's totals
// band and activity chart read the same on either host. The console never calls
// this — its `getCabinetStats` asks the backend, whose corpus additionally
// covers unpublished runs the snapshot cannot hold.

import type { RunSummary } from "@clockwyrks/run-record/snapshot";
import type { CabinetStatsResponse } from "@clockwyrks/run-record/backend-api";
import { totalTokens } from "../format";

/** The cabinet's headline figures, as the app consumes them — the wire shape of
 * `GET /stats/cabinet`, which the static fold below reproduces. */
export type CabinetStats = CabinetStatsResponse;

// How many weeks the activity series covers — a year, the newest being the
// current (partial) week. Mirrors the backend's `CABINET_WEEKS`.
const CABINET_WEEKS = 52;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/**
 * Fold summary cards into the cabinet's headline figures, mirroring the
 * backend's `fold_cabinet_stats` semantics exactly:
 *
 * - Tokens: a run whose {@link totalTokens} is null reported none — it counts as
 *   unreported and contributes nothing. A total of exactly 0 counts as
 *   unreported too: the backend's lifted `total_tokens` column stores 0 for an
 *   unreported record and cannot tell it from a genuine zero, so it counts a 0
 *   as unreported, and this mirror must not disagree over the same corpus.
 * - Cost: a null comparable cost is unknown — excluded from the sum and
 *   counted; a known 0.0 (a free run) sums.
 * - Weekly: runs bucketed by the UTC Monday of the ISO week `startedAt` falls
 *   in, the last {@link CABINET_WEEKS} weeks up to `now` inclusive, ascending,
 *   with EXPLICIT zero entries for empty weeks. A run outside the window (or
 *   with an unparseable timestamp) still counts in every total but charts
 *   nowhere.
 *
 * `now` anchors the window's newest bucket and is passed in so the fold stays a
 * pure function of its inputs (the caller supplies `new Date()`).
 */
export function foldCabinetStats(
  summaries: readonly RunSummary[],
  now: Date,
): CabinetStats {
  // The window's bucket keys, oldest first: each week's UTC-Monday-midnight
  // instant in epoch ms. Week arithmetic in plain ms is exact here because UTC
  // days have no DST discontinuities.
  const thisWeek = weekMondayUtcMs(now.getTime());
  const weekStarts: number[] = [];
  for (let weeksBack = CABINET_WEEKS - 1; weeksBack >= 0; weeksBack -= 1) {
    weekStarts.push(thisWeek - weeksBack * WEEK_MS);
  }
  const weekly = new Map<number, number>(weekStarts.map((ms) => [ms, 0]));

  let tokensTotal = 0;
  let tokensUnreported = 0;
  let costTotal = 0;
  let costUnreported = 0;
  const testCases = new Set<string>();
  const models = new Set<string>();
  for (const summary of summaries) {
    const tokens = totalTokens(summary.metrics);
    if (tokens !== null && tokens > 0) tokensTotal += tokens;
    else tokensUnreported += 1;
    const cost = summary.metrics.cost.comparable;
    if (cost !== null) costTotal += cost;
    else costUnreported += 1;
    testCases.add(summary.subject.testCaseSlug);
    models.add(summary.subject.modelId);
    const started = Date.parse(summary.startedAt);
    if (!Number.isNaN(started)) {
      const week = weekMondayUtcMs(started);
      const count = weekly.get(week);
      if (count !== undefined) weekly.set(week, count + 1);
    }
  }

  return {
    runs: summaries.length,
    tokens: { total: tokensTotal, unreportedRuns: tokensUnreported },
    cost: { total: costTotal, unreportedRuns: costUnreported },
    testCases: testCases.size,
    models: models.size,
    weekly: weekStarts.map((ms) => ({
      weekStart: formatWeekStart(ms),
      runs: weekly.get(ms) ?? 0,
    })),
  };
}

/**
 * Open the activity chart's axis at the first week that actually saw a run:
 * drop the leading zero weeks the fixed window pads a younger (or quieter)
 * corpus with, keeping every zero after that first active week (an idle week
 * mid-history is signal). A series with no active week at all is returned
 * whole — the flat zero line honestly shows a year of quiet.
 */
export function trimLeadingIdleWeeks(
  weekly: CabinetStats["weekly"],
): CabinetStats["weekly"] {
  const first = weekly.findIndex((week) => week.runs > 0);
  return first === -1 ? weekly : weekly.slice(first);
}

// The UTC-Monday-midnight instant (epoch ms) beginning the ISO week `ms` falls
// in — the bucket key. Mirrors the backend's `week_monday`, on the UTC calendar
// day of the instant (`getUTCDay`: 0 = Sunday, so Monday-distance is `(day + 6)
// % 7`).
export function weekMondayUtcMs(ms: number): number {
  const date = new Date(ms);
  const dayStart = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
  const daysFromMonday = (date.getUTCDay() + 6) % 7;
  return dayStart - daysFromMonday * DAY_MS;
}

// A bucket key as the wire's `YYYY-MM-DD` — the UTC date of the Monday
// instant. Mirrors the backend's `format_week_start`.
export function formatWeekStart(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
