import { describe, expect, it, vi } from "vitest";
import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import { drainCaseSummaries } from "./useRuns";
import type { RunQuery, RunQueryResult } from "./runQuery";

// A stand-in summary; the drain only ever counts and concatenates these.
function summary(id: string): RunSummary {
  return { id } as unknown as RunSummary;
}

/**
 * A host that serves a windowed query but caps each response at `serverMax` rows,
 * however many the caller asked for — exactly what the backend does (it clamps the
 * `limit` parameter to its own ceiling without saying so).
 */
function pagedHost(total: number, serverMax: number) {
  const rows = Array.from({ length: total }, (_, i) => summary(`run-${i}`));
  return vi.fn(
    async (query: RunQuery): Promise<RunQueryResult> => ({
      summaries: rows.slice(
        query.offset ?? 0,
        (query.offset ?? 0) + Math.min(query.limit ?? total, serverMax),
      ),
      total,
    }),
  );
}

describe("drainCaseSummaries", () => {
  // The bug this guards: the drain advanced its offset by the limit it REQUESTED
  // rather than the number of rows it RECEIVED. Against a host that clamps, the
  // offset outran the data and the runs in the gap vanished — quietly, from the
  // case leaderboard and every metric computed off this set.
  it("returns every run when the host serves fewer rows than requested", async () => {
    const query = pagedHost(450, 200);

    const drained = await drainCaseSummaries(query, "carom");

    expect(drained).toHaveLength(450);
    expect(new Set(drained.map((r) => r.id)).size).toBe(450);
  });

  it("stops once the whole set is drained", async () => {
    const query = pagedHost(200, 200);

    const drained = await drainCaseSummaries(query, "carom");

    expect(drained).toHaveLength(200);
    // One request for the full page, and no needless second one: the accumulated
    // count already matches the reported total.
    expect(query).toHaveBeenCalledTimes(1);
  });

  // A case with no published runs must terminate rather than loop on an offset
  // that never advances.
  it("terminates on an empty result", async () => {
    const query = pagedHost(0, 200);

    await expect(drainCaseSummaries(query, "carom")).resolves.toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
