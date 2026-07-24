import { describe, expect, it } from "vitest";
import type { PerformanceSnapshotCheck } from "@test-cabinet/run-record";
import { firstDrift } from "./drift";
import type { Snapshot } from "./renderer";

/** A frame carrying only what the gate reads: its tick and its checksum. */
function frame(tick: number, checksum: string): Snapshot {
  return { tick, checksum, entities: [] } as unknown as Snapshot;
}

function graded(...ticks: Array<[number, string]>): PerformanceSnapshotCheck[] {
  return ticks.map(([tick, checksum]) => ({ tick, checksum }));
}

describe("firstDrift", () => {
  it("passes frames that carry the checksums the run recorded", () => {
    const record = graded([1250, "fnv1a64:aaaa"], [2500, "fnv1a64:bbbb"]);
    const frames = [
      frame(1249, "fnv1a64:whatever"),
      frame(1250, "fnv1a64:aaaa"),
      frame(2500, "fnv1a64:bbbb"),
    ];
    expect(firstDrift(record, frames)).toBeNull();
  });

  it("reports the first graded tick whose frame disagrees", () => {
    // Two graded ticks drift; the first is the informative one — the second is its
    // consequence, since a diverged world stays diverged.
    const record = graded([1250, "fnv1a64:aaaa"], [2500, "fnv1a64:bbbb"]);
    const frames = [frame(1250, "fnv1a64:dead"), frame(2500, "fnv1a64:beef")];
    expect(firstDrift(record, frames)).toEqual({
      tick: 1250,
      played: "fnv1a64:dead",
      recorded: "fnv1a64:aaaa",
    });
  });

  it("ignores ticks the run did not grade", () => {
    // Between graded ticks there is nothing to compare against: an ungraded frame is
    // unverifiable, not wrong.
    const record = graded([2500, "fnv1a64:bbbb"]);
    expect(firstDrift(record, [frame(7, "fnv1a64:anything")])).toBeNull();
  });

  it("checks nothing when there is no graded record", () => {
    // The case's Reference tab plays the authoritative engine against no run at all,
    // so it has no record to drift from and must never raise a warning.
    const frames = [frame(1250, "fnv1a64:aaaa")];
    expect(firstDrift(undefined, frames)).toBeNull();
    expect(firstDrift([], frames)).toBeNull();
  });

  it("finds a drift anywhere in the batch it is handed", () => {
    // Frames stream in batches, so the gate is called per batch and must scan the
    // whole batch, not just its head.
    const record = graded([2500, "fnv1a64:bbbb"]);
    const frames = [
      frame(2498, "fnv1a64:x"),
      frame(2499, "fnv1a64:y"),
      frame(2500, "fnv1a64:zzzz"),
    ];
    expect(firstDrift(record, frames)?.tick).toBe(2500);
  });
});
