// Matching, extraction, scoring and chains, driven through real insertions and
// real merges.

import { describe, expect, it } from "vitest";
import { CHAIN_RESET, RECOIL, SPACING } from "./constants";
import { bare, last, seatShot, topLegS, type Harness } from "./harness.test";

describe("extraction on an insertion", () => {
  it("draws out a run of three and leaves the rest", async () => {
    const h = await bare();
    const head = topLegS(430);
    await seatShot(
      h,
      [
        [head, "halide", null],
        [head - SPACING, "halide", null],
        [head - 2 * SPACING, "cobalt", null],
      ],
      "halide",
    );
    const train = h.api.snapshot().train;
    expect(train).toHaveLength(1);
    expect(train[0].charge).toBe("cobalt");
    h.dispose();
  });

  it("leaves a run of only two on the channel, and scores nothing", async () => {
    const h = await bare();
    const before = h.api.snapshot().score;
    const head = topLegS(430);
    await seatShot(
      h,
      [
        [head, "halide", null],
        [head - SPACING, "cobalt", null],
        [head - 2 * SPACING, "cobalt", null],
      ],
      "halide",
    );
    const shot = h.api.snapshot();
    expect(shot.train).toHaveLength(4);
    expect(shot.score).toBe(before);
    h.dispose();
  });

  it("scores ten for each core, at the chain step it resolved at", async () => {
    const h = await bare();
    const before = h.api.snapshot().score;
    const head = topLegS(430);
    await seatShot(
      h,
      [
        [head, "halide", null],
        [head - SPACING, "halide", null],
        [head - 2 * SPACING, "cobalt", null],
      ],
      "halide",
    );
    expect(h.api.snapshot().score - before).toBe(30);
    expect(h.api.snapshot().chainStep).toBe(1);
    expect(h.api.snapshot().chainTimer).toBeCloseTo(CHAIN_RESET, 6);
    expect(h.cues.map((play) => play.cue)).toContain("extract-1");
    h.dispose();
  });

  it("drops the pressure by 0.8 for each core it took", async () => {
    const h = await bare();
    h.api.setPressure(50);
    const head = topLegS(430);
    await seatShot(
      h,
      [
        [head, "halide", null],
        [head - SPACING, "halide", null],
        [head - 2 * SPACING, "cobalt", null],
      ],
      "halide",
    );
    // Three cores drawn out is 2.4. The eleven ticks the shot was in the air each
    // bled 2.0 a second off an uncrowded channel, which is the rest of the fall.
    expect(h.api.snapshot().pressure).toBeCloseTo(50 - 2.4 - 11 * (2 / 60), 3);
    h.dispose();
  });

  it("recoils the train behind it and holds it there", async () => {
    const h = await bare();
    const head = topLegS(430);
    const trailing = head - 3 * SPACING;
    await seatShot(
      h,
      [
        [head, "halide", null],
        [head - SPACING, "halide", null],
        [head - 2 * SPACING, "cobalt", null],
        [trailing, "cobalt", null],
        [trailing - SPACING, "garnet", null],
        [trailing - 2 * SPACING, "garnet", null],
      ],
      "halide",
    );
    const after = h.api.snapshot();
    const tail = last(after.train).s;
    expect(last(after.segments).hold).toBeCloseTo(0.4, 6);
    await h.step(23);
    expect(last(h.api.snapshot().train).s).toBeCloseTo(tail, 3);
    await h.step(2);
    expect(last(h.api.snapshot().train).s).toBeGreaterThan(tail);
    h.dispose();
  });

  it("falls back by the whole recoil where there is room", async () => {
    const h = await bare();
    const head = topLegS(430);
    await seatShot(
      h,
      [
        [head, "halide", null],
        [head - SPACING, "halide", null],
        [head - 2 * SPACING, "cobalt", null],
        [head - 3 * SPACING, "cobalt", null],
      ],
      "halide",
    );
    const train = h.api.snapshot().train;
    expect(train).toHaveLength(2);
    // The two cobalt cores were shifted one spacing back to make room for the
    // seated core, and then driven a whole recoil back when the run left.
    const ridden = 22 / 60;
    expect(train[0].s).toBeCloseTo(
      head - 2 * SPACING + ridden - SPACING - RECOIL,
      3,
    );
    expect(train[1].s).toBeCloseTo(train[0].s - SPACING, 6);
    h.dispose();
  });
});

describe("extraction on a merge", () => {
  it("draws out the run spanning the join", async () => {
    const h = await bare();
    h.api.poseTrain([
      [2000, "halide", null],
      [1972, "cobalt", null],
      [1944, "cobalt", null],
      [1800, "cobalt", null],
    ]);
    for (let i = 0; i < 200; i += 1) {
      await h.step();
      if (h.api.snapshot().train.length < 4) break;
    }
    const train = h.api.snapshot().train;
    expect(train).toHaveLength(1);
    expect(train[0].charge).toBe("halide");
    h.dispose();
  });

  it("leaves a join of two different charges alone", async () => {
    const h = await bare();
    h.api.poseTrain([
      [2000, "halide", null],
      [1972, "cobalt", null],
      [1944, "cobalt", null],
      [1800, "garnet", null],
    ]);
    await h.step(200);
    expect(h.api.snapshot().train).toHaveLength(4);
    h.dispose();
  });
});

describe("the chain", () => {
  /**
   * A hall posed so that one insertion draws out three, and the merge that closes
   * behind it draws out three more.
   */
  async function chained(): Promise<Harness> {
    const h = await bare();
    const head = topLegS(430);
    // Ahead: two halide waiting for the shot. Behind, one spacing clear of the
    // recoil, three cobalt that close the gap and merge.
    await seatShot(
      h,
      [
        [head, "halide", null],
        [head - SPACING, "halide", null],
        [head - 2 * SPACING, "cobalt", null],
        [head - 3 * SPACING - 60, "cobalt", null],
        [head - 4 * SPACING - 60, "cobalt", null],
      ],
      "halide",
      // Spent on the strike tick alone, so the level clears when the merge
      // extraction empties the channel rather than during the flight.
      () => {
        h.api.setQuotaRemaining(0);
      },
    );
    return h;
  }

  it("scores the insertion at step 1 and the merge that follows at step 2", async () => {
    const h = await chained();
    const afterInsertion = h.api.snapshot();
    expect(afterInsertion.chainStep).toBe(1);
    const scored = afterInsertion.score;

    for (let i = 0; i < 200; i += 1) {
      await h.step();
      if (h.api.snapshot().train.length === 0) break;
    }
    const after = h.api.snapshot();
    expect(after.chainStep).toBe(2);
    // Three cobalt at step two is 60, and emptying the channel pays the clear.
    expect(after.score - scored).toBe(60 + 500);
    expect(h.cues.map((play) => play.cue)).toContain("extract-2");
    h.dispose();
  });

  it("takes the chain back to step 1 on the next insertion extraction", async () => {
    const h = await chained();
    for (let i = 0; i < 200; i += 1) {
      await h.step();
      if (h.api.snapshot().chainStep === 2) break;
    }
    expect(h.api.snapshot().chainStep).toBe(2);

    // The channel emptied and the level cleared, so the chain is checked on a
    // hall posed afresh inside the same chain window.
    h.api.resume();
    h.api.setQuotaRemaining(0);
    h.api.poseTrain([[100, "olivine", null]]);
    const scored = h.api.snapshot().score;
    const head = topLegS(430);
    await seatShot(
      h,
      [
        [head, "garnet", null],
        [head - SPACING, "garnet", null],
        [head - 2 * SPACING, "cobalt", null],
      ],
      "garnet",
    );
    expect(h.api.snapshot().chainStep).toBe(1);
    expect(h.api.snapshot().score - scored).toBe(30);
    h.dispose();
  });

  it("lapses back to step 1 when the hall goes quiet", async () => {
    const h = await chained();
    for (let i = 0; i < 200; i += 1) {
      await h.step();
      if (h.api.snapshot().chainStep === 2) break;
    }
    h.api.resume();
    h.api.setQuotaRemaining(0);
    h.api.poseTrain([[1000, "halide", null]]);
    await h.step(122);
    const after = h.api.snapshot();
    expect(after.chainStep).toBe(1);
    expect(after.chainTimer).toBe(0);
    h.dispose();
  });
});
