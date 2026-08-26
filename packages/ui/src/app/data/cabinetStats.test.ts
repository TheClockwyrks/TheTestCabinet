import { describe, expect, it } from "vitest";
import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import {
  foldCabinetStats,
  formatWeekStart,
  trimLeadingIdleWeeks,
  weekMondayUtcMs,
} from "./cabinetStats";

// The same Wednesday anchor the backend's fold tests use (`cabinet_now` in
// crates/backend/src/stats.test.rs): its week's Monday is 2026-08-24, so the
// 52-week window opens on 2025-09-01.
const NOW = new Date("2026-08-26T12:00:00Z");

// A summary carrying only the fields the fold reads. `tokens` is the uncached
// input count (null = no category reported at all); `cost` is the comparable
// cost (null = unknown).
function run(
  id: string,
  fields: {
    startedAt?: string;
    tokens?: number | null;
    cost?: number | null;
    testCase?: string;
    model?: string;
  } = {},
): RunSummary {
  return {
    id,
    startedAt: fields.startedAt ?? "2026-08-25T10:00:00Z",
    subject: {
      testCaseSlug: fields.testCase ?? "pong",
      modelId: fields.model ?? "sonnet",
    },
    metrics: {
      tokens: {
        uncachedInput: fields.tokens === undefined ? 100 : fields.tokens,
        cachedInput: null,
        output: null,
        reasoning: null,
      },
      cost: { comparable: fields.cost === undefined ? 1 : fields.cost },
    },
  } as unknown as RunSummary;
}

describe("foldCabinetStats", () => {
  // Mirrors `an_empty_cabinet_still_charts_the_full_window_of_zero_weeks`.
  it("an empty corpus still charts the full window of zero weeks", () => {
    const stats = foldCabinetStats([], NOW);
    expect(stats.runs).toBe(0);
    expect(stats.tokens).toEqual({ total: 0, unreportedRuns: 0 });
    expect(stats.cost).toEqual({ total: 0, unreportedRuns: 0 });
    expect(stats.testCases).toBe(0);
    expect(stats.models).toBe(0);
    // Explicit zero entries for every week, ascending, Mondays throughout.
    expect(stats.weekly).toHaveLength(52);
    expect(stats.weekly[0]!.weekStart).toBe("2025-09-01");
    expect(stats.weekly[51]!.weekStart).toBe("2026-08-24");
    expect(stats.weekly.every((week) => week.runs === 0)).toBe(true);
  });

  // Mirrors `cabinet_totals_exclude_and_count_unreported_tokens_and_cost`.
  it("totals exclude and count unreported tokens and cost", () => {
    const stats = foldCabinetStats(
      [
        run("a", {
          tokens: 1_000,
          cost: 2.5,
          testCase: "pong",
          model: "sonnet",
        }),
        // A null token total is an unreported run, and a null cost is unknown:
        // both count, neither sums.
        run("b", { tokens: null, cost: null, testCase: "pong", model: "opus" }),
        run("c", {
          tokens: 500,
          cost: 0.0,
          testCase: "meltdown",
          model: "sonnet",
        }),
      ],
      NOW,
    );
    expect(stats.runs).toBe(3);
    expect(stats.tokens).toEqual({ total: 1_500, unreportedRuns: 1 });
    // A genuine 0.0 (a free run) is a known cost: summed, not counted.
    expect(stats.cost).toEqual({ total: 2.5, unreportedRuns: 1 });
    // Distinct identities, not row counts.
    expect(stats.testCases).toBe(2);
    expect(stats.models).toBe(2);
  });

  it("a zero token total counts as unreported, like the backend's lifted 0", () => {
    // The backend's lifted column stores 0 for an unreported record and cannot
    // tell it from a genuine zero, so it counts a 0 as unreported; the mirror
    // must not disagree over the same corpus.
    const stats = foldCabinetStats([run("a", { tokens: 0 })], NOW);
    expect(stats.tokens).toEqual({ total: 0, unreportedRuns: 1 });
  });

  // Mirrors `cabinet_weekly_buckets_by_the_utc_monday_of_the_iso_week`.
  it("buckets weekly by the UTC Monday of the ISO week", () => {
    const stats = foldCabinetStats(
      [
        // Monday and Sunday of one ISO week share its Monday bucket…
        run("a", { startedAt: "2026-08-17T00:00:00Z" }),
        run("b", { startedAt: "2026-08-23T23:59:59Z" }),
        // …and the bucketing is on the UTC instant: 23:30+02:00 late Sunday is
        // 21:30 UTC, still Sunday.
        run("c", { startedAt: "2026-08-23T23:30:00+02:00" }),
        // The current (partial) week is included…
        run("d", { startedAt: "2026-08-26T09:00:00Z" }),
        // …a run older than the window counts in the totals but charts nowhere…
        run("e", { startedAt: "2025-01-01T00:00:00Z" }),
        // …and so does one whose timestamp does not parse.
        run("f", { startedAt: "not-a-timestamp" }),
      ],
      NOW,
    );
    expect(stats.runs).toBe(6);
    const week = (start: string) =>
      stats.weekly.find((w) => w.weekStart === start)?.runs;
    expect(week("2026-08-17")).toBe(3);
    expect(week("2026-08-24")).toBe(1);
    expect(stats.weekly.reduce((sum, w) => sum + w.runs, 0)).toBe(4);
    // Ascending, and every entry a Monday one week apart.
    const starts = stats.weekly.map((w) => w.weekStart);
    expect(starts).toEqual([...starts].sort());
  });
});

// Mirrors `week_monday_is_identity_on_mondays_and_floors_the_rest_of_the_week`.
describe("weekMondayUtcMs", () => {
  it("is identity on Mondays and floors the rest of the week", () => {
    const monday = Date.parse("2026-08-24T00:00:00Z");
    expect(weekMondayUtcMs(monday)).toBe(monday);
    expect(weekMondayUtcMs(Date.parse("2026-08-30T00:00:00Z"))).toBe(monday);
    // A year boundary inside a week floors into the old year.
    expect(weekMondayUtcMs(Date.parse("2026-01-01T00:00:00Z"))).toBe(
      Date.parse("2025-12-29T00:00:00Z"),
    );
    expect(formatWeekStart(monday)).toBe("2026-08-24");
  });
});

describe("trimLeadingIdleWeeks", () => {
  const week = (weekStart: string, runs: number) => ({ weekStart, runs });

  it("opens at the first active week, keeping later idle weeks", () => {
    const weekly = [
      week("2026-08-03", 0),
      week("2026-08-10", 2),
      week("2026-08-17", 0),
      week("2026-08-24", 1),
    ];
    expect(trimLeadingIdleWeeks(weekly)).toEqual(weekly.slice(1));
  });

  it("returns an already-active series whole", () => {
    const weekly = [week("2026-08-17", 3), week("2026-08-24", 0)];
    expect(trimLeadingIdleWeeks(weekly)).toEqual(weekly);
  });

  it("returns an all-idle series whole, so the quiet year still charts", () => {
    const weekly = [week("2026-08-17", 0), week("2026-08-24", 0)];
    expect(trimLeadingIdleWeeks(weekly)).toEqual(weekly);
  });
});
