// Matching, extraction, scoring and chains, driven through real insertions and
// real merges.

import { describe, expect, it } from "vitest";
import { CHAIN_RESET, RECOIL, SPACING } from "./constants";
import { harness, last, seatShot, topLegS } from "./harness.test";

/**
 * A hall on level 1 with the inlet spent and one core parked by the inlet.
 *
 * The parked core is what keeps the level open while a shot is in flight: an empty
 * channel under a spent quota is a cleared level (specs/channel.md, step 6), and a
 * cleared level advances nothing. `seatShot` replaces it with the posed train, so
 * it never takes part in what is measured.
 */
function bare() {
  const hall = harness();
  hall.api.startLevel(1);
  hall.api.setPressure(0);
  hall.api.setQuotaRemaining(0);
  hall.api.clearTrain();
  hall.api.poseTrain([[100, "olivine", null]]);
  return hall;
}

describe("extraction on an insertion", () => {
  it("draws out a run of three and leaves the rest", () => {
    const hall = bare();
    const head = topLegS(430);
    seatShot(
      hall,
      [
        [head, "halide", null],
        [head - SPACING, "halide", null],
        [head - 2 * SPACING, "cobalt", null],
      ],
      "halide",
    );
    const train = hall.api.snapshot().train;
    expect(train).toHaveLength(1);
    expect(train[0].charge).toBe("cobalt");
  });

  it("leaves a run of only two on the channel, and scores nothing", () => {
    const hall = bare();
    const before = hall.api.snapshot().score;
    const head = topLegS(430);
    seatShot(
      hall,
      [
        [head, "halide", null],
        [head - SPACING, "cobalt", null],
        [head - 2 * SPACING, "cobalt", null],
      ],
      "halide",
    );
    const shot = hall.api.snapshot();
    expect(shot.train).toHaveLength(4);
    expect(shot.score).toBe(before);
  });

  it("scores ten for each core, at the chain step it resolved at", () => {
    const hall = bare();
    const before = hall.api.snapshot().score;
    const head = topLegS(430);
    seatShot(
      hall,
      [
        [head, "halide", null],
        [head - SPACING, "halide", null],
        [head - 2 * SPACING, "cobalt", null],
      ],
      "halide",
    );
    expect(hall.api.snapshot().score - before).toBe(30);
    expect(hall.api.snapshot().chainStep).toBe(1);
    expect(hall.api.snapshot().chainTimer).toBeCloseTo(CHAIN_RESET, 6);
    expect(hall.cues).toContain("extract-1");
  });

  it("drops the pressure by 0.8 for each core it took", () => {
    const hall = bare();
    hall.api.setPressure(50);
    const head = topLegS(430);
    seatShot(
      hall,
      [
        [head, "halide", null],
        [head - SPACING, "halide", null],
        [head - 2 * SPACING, "cobalt", null],
      ],
      "halide",
    );
    // Three cores drawn out is 2.4. The eleven ticks the shot was in the air each
    // bled 2.0 a second off an uncrowded channel, which is the rest of the fall.
    expect(hall.api.snapshot().pressure).toBeCloseTo(
      50 - 2.4 - 11 * (2 / 60),
      3,
    );
  });

  it("recoils the train behind it and holds it there", () => {
    const hall = bare();
    const head = topLegS(430);
    const trailing = head - 3 * SPACING;
    seatShot(
      hall,
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
    const after = hall.api.snapshot();
    const tail = last(after.train).s;
    // The cores behind fell one whole recoil back, and now stand still.
    expect(last(after.segments).hold).toBeCloseTo(0.4, 6);
    hall.step(23);
    expect(last(hall.api.snapshot().train).s).toBeCloseTo(tail, 3);
    hall.step(2);
    expect(last(hall.api.snapshot().train).s).toBeGreaterThan(tail);
  });

  it("falls back by the whole recoil where there is room", () => {
    const hall = bare();
    const head = topLegS(430);
    seatShot(
      hall,
      [
        [head, "halide", null],
        [head - SPACING, "halide", null],
        [head - 2 * SPACING, "cobalt", null],
        [head - 3 * SPACING, "cobalt", null],
      ],
      "halide",
    );
    const train = hall.api.snapshot().train;
    expect(train).toHaveLength(2);
    // The two cobalt cores were shifted one spacing back to make room for the
    // seated core, and then driven a whole recoil back when the run left.
    const ridden = 22 / 60;
    expect(train[0].s).toBeCloseTo(
      head - 2 * SPACING + ridden - SPACING - RECOIL,
      3,
    );
    expect(train[1].s).toBeCloseTo(train[0].s - SPACING, 6);
  });
});

describe("extraction on a merge", () => {
  it("draws out the run spanning the join", () => {
    const hall = bare();
    hall.api.poseTrain([
      [2000, "halide", null],
      [1972, "cobalt", null],
      [1944, "cobalt", null],
      [1800, "cobalt", null],
    ]);
    for (let i = 0; i < 200; i += 1) {
      hall.step();
      if (hall.api.snapshot().train.length < 4) break;
    }
    const train = hall.api.snapshot().train;
    expect(train).toHaveLength(1);
    expect(train[0].charge).toBe("halide");
  });

  it("leaves a join of two different charges alone", () => {
    const hall = bare();
    hall.api.poseTrain([
      [2000, "halide", null],
      [1972, "cobalt", null],
      [1944, "cobalt", null],
      [1800, "garnet", null],
    ]);
    hall.step(200);
    expect(hall.api.snapshot().train).toHaveLength(4);
  });
});

describe("the chain", () => {
  /**
   * A hall posed so that one insertion draws out three, and the merge that closes
   * behind it draws out three more.
   */
  function chained() {
    const hall = bare();
    const head = topLegS(430);
    // Ahead: two halide waiting for the shot. Behind, one spacing clear of the
    // recoil, three cobalt that close the gap and merge.
    seatShot(
      hall,
      [
        [head, "halide", null],
        [head - SPACING, "halide", null],
        [head - 2 * SPACING, "cobalt", null],
        [head - 3 * SPACING - 60, "cobalt", null],
        [head - 4 * SPACING - 60, "cobalt", null],
      ],
      "halide",
    );
    return hall;
  }

  it("scores the insertion at step 1 and the merge that follows at step 2", () => {
    const hall = chained();
    const afterInsertion = hall.api.snapshot();
    expect(afterInsertion.chainStep).toBe(1);
    const scored = afterInsertion.score;

    for (let i = 0; i < 200; i += 1) {
      hall.step();
      if (hall.api.snapshot().train.length === 0) break;
    }
    const after = hall.api.snapshot();
    expect(after.chainStep).toBe(2);
    // Three cobalt at step two is 60, and emptying the channel pays the clear.
    expect(after.score - scored).toBe(60 + 500);
    expect(hall.cues).toContain("extract-2");
  });

  it("takes the chain back to step 1 on the next insertion extraction", () => {
    const hall = chained();
    for (let i = 0; i < 200; i += 1) {
      hall.step();
      if (hall.api.snapshot().chainStep === 2) break;
    }
    expect(hall.api.snapshot().chainStep).toBe(2);

    // The channel emptied and the level cleared, so the chain is checked on a hall
    // posed afresh inside the same chain window.
    hall.api.resume();
    hall.api.setQuotaRemaining(0);
    hall.api.poseTrain([[100, "olivine", null]]);
    const scored = hall.api.snapshot().score;
    const head = topLegS(430);
    seatShot(
      hall,
      [
        [head, "garnet", null],
        [head - SPACING, "garnet", null],
        [head - 2 * SPACING, "cobalt", null],
      ],
      "garnet",
    );
    expect(hall.api.snapshot().chainStep).toBe(1);
    expect(hall.api.snapshot().score - scored).toBe(30);
  });

  it("lapses back to step 1 when the hall goes quiet", () => {
    const hall = chained();
    for (let i = 0; i < 200; i += 1) {
      hall.step();
      if (hall.api.snapshot().chainStep === 2) break;
    }
    hall.api.resume();
    hall.api.setQuotaRemaining(0);
    hall.api.poseTrain([[1000, "halide", null]]);
    hall.step(122);
    const after = hall.api.snapshot();
    expect(after.chainStep).toBe(1);
    expect(after.chainTimer).toBe(0);
  });
});
