// Matching, extraction, recoil, scoring, and chains (specs/extraction.md).
//
// The insertions here fire DOWN onto the channel's leg at `y = 420`, whose
// forward direction is `-x`: a shot landing at smaller x arrives in front of the
// core it strikes and seats ahead of it, which is the shortest way to complete a
// run at the head of a posed segment.

import { describe, expect, it } from "vitest";
import { CHAIN_RESET, SPACING } from "./constants";
import type { PosedCore } from "./debug";
import {
  current,
  isolate,
  onLowerLeg,
  poseTrain,
  seatAhead,
  toward,
  useHarness,
} from "./harness";

useHarness();

/** The head of every posed segment in these checks. */
const HEAD = onLowerLeg(400);

/**
 * A core parked far behind everything else, so an emptied head of the train does
 * not clear the level and stop the clock the check is watching.
 */
const SPARE: PosedCore = [1000, "garnet", null];

/** A segment of `charges`, head first, one spacing apart, starting at `head`. */
function segment(head: number, charges: readonly string[]): PosedCore[] {
  return charges.map((charge, i): PosedCore => [
    head - i * SPACING,
    charge,
    null,
  ]);
}

describe("runs", () => {
  it("draws out a run of three completed by an insertion", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, segment(HEAD, ["halide", "halide", "cobalt"]));
    await seatAhead("halide");

    const train = h.snapshot().train;
    expect(train).toHaveLength(1);
    expect(train[0].charge).toBe("cobalt");
  });

  it("scores an extraction of three at chain step 1 as exactly 30", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, segment(HEAD, ["halide", "halide", "cobalt"]));
    expect(h.snapshot().score).toBe(0);
    await seatAhead("halide");
    expect(h.snapshot().score).toBe(30);
    expect(h.snapshot().chainStep).toBe(1);
  });

  it("leaves a run of two on the channel, and scores nothing", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, segment(HEAD, ["halide", "cobalt", "cobalt"]));
    await seatAhead("halide");

    expect(h.snapshot().train).toHaveLength(4);
    expect(h.snapshot().score).toBe(0);
  });

  it("recoils the trailing train behind a removal", async () => {
    const h = current();
    await isolate(h);
    poseTrain(
      h,
      segment(HEAD, [
        "halide",
        "halide",
        "cobalt",
        "cobalt",
        "cobalt",
        "cobalt",
      ]),
    );

    let before = h.snapshot();
    let after = before;
    h.debug.setLoaded("halide");
    h.debug.setAim(toward(380, 420));
    h.debug.fire();
    for (let i = 0; i < 20; i += 1) {
      before = h.snapshot();
      await h.engine.advance(1);
      after = h.snapshot();
      if (after.train.length === 4) break;
    }
    expect(after.train).toHaveLength(4);

    // Across the tick: the segment advanced 22/60, the insertion shifted the
    // trailing cores back one spacing, and the recoil took a further 42.
    const tailBefore = before.train[before.train.length - 1].s;
    const tailAfter = after.train[after.train.length - 1].s;
    expect(tailBefore - tailAfter).toBeCloseTo(28 + 42 - 22 / 60, 2);
    expect(after.segments[0].hold).toBeCloseTo(0.4, 6);
  });
});

describe("merges", () => {
  it("draws out a run completed across a join", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [
      [1000, "halide", null],
      [972, "cobalt", null],
      [944, "cobalt", null],
      [844, "cobalt", null],
    ]);
    await h.engine.advance(60);

    const train = h.snapshot().train;
    expect(train).toHaveLength(1);
    expect(train[0].charge).toBe("halide");
  });

  it("scores a merge extraction at the incremented chain step", async () => {
    const h = current();
    await isolate(h);
    // An insertion extraction of three, whose recoil leaves a trailing cobalt
    // segment closing on a cobalt pair — a merge extraction of three at step 2.
    poseTrain(h, [
      ...segment(HEAD, ["halide", "halide", "cobalt", "cobalt"]),
      [HEAD - 4 * SPACING - 72, "cobalt", null],
      SPARE,
    ]);

    await seatAhead("halide");
    expect(h.snapshot().score).toBe(30);
    expect(h.snapshot().chainStep).toBe(1);

    await h.engine.advance(90);
    expect(h.snapshot().train).toHaveLength(1);
    expect(h.snapshot().chainStep).toBe(2);
    // 30 for the first three, then 10 x 3 x 2 for the chained three.
    expect(h.snapshot().score).toBe(30 + 60);
  });

  it("takes the chain back to step 1 on the next insertion extraction", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [
      ...segment(HEAD, ["halide", "halide", "cobalt", "cobalt"]),
      [HEAD - 4 * SPACING - 72, "cobalt", null],
      SPARE,
    ]);
    await seatAhead("halide");
    await h.engine.advance(90);
    expect(h.snapshot().chainStep).toBe(2);

    const scored = h.snapshot().score;
    poseTrain(h, [...segment(HEAD, ["olivine", "olivine", "garnet"]), SPARE]);
    await seatAhead("olivine");
    expect(h.snapshot().chainStep).toBe(1);
    expect(h.snapshot().score - scored).toBe(30);
  });

  it("lets the chain lapse after the reset window", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [
      ...segment(HEAD, ["halide", "halide", "cobalt", "cobalt"]),
      [HEAD - 4 * SPACING - 72, "cobalt", null],
      SPARE,
    ]);
    await seatAhead("halide");
    await h.engine.advance(90);
    expect(h.snapshot().chainStep).toBe(2);

    await h.engine.advance(Math.ceil(CHAIN_RESET * 60) + 2);
    expect(h.snapshot().chainStep).toBe(1);
    expect(h.snapshot().chainTimer).toBe(0);
    expect(h.snapshot().screen).toBe("playing");
  });
});
