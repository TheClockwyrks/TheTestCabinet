// The four machinery kinds: the cadence that places a mark, the cycle that names
// it, the grant that fires it, and each effect on its own.

import { describe, expect, it } from "vitest";
import { BORE_RADIUS, MARK_INTERVAL, SEED_CORES, SPACING } from "./constants";
import { pointAt } from "./channel";
import { harness, last, seatShot, topLegS } from "./harness.test";

function bare() {
  const hall = harness();
  hall.api.startLevel(1);
  hall.api.setPressure(0);
  hall.api.setQuotaRemaining(0);
  hall.api.clearTrain();
  hall.api.poseTrain([[100, "olivine", null]]);
  return hall;
}

describe("marks", () => {
  it("marks the twelfth core of a level, and none of the eleven before it", () => {
    const hall = harness();
    hall.api.startLevel(1);
    const train = hall.api.snapshot().train;
    expect(last(train).mark).toBe("choke");
    for (const core of train.slice(0, SEED_CORES - 1)) {
      expect(core.mark).toBeNull();
    }
  });

  it("marks every twelfth core the level delivers", () => {
    const hall = harness();
    hall.api.startLevel(1);
    const marks: (string | null)[] = hall.api
      .snapshot()
      .train.map((core) => core.mark);

    let delivered = SEED_CORES;
    for (let i = 0; i < 4000 && delivered < 24; i += 1) {
      const before = hall.api.snapshot();
      hall.step();
      const after = hall.api.snapshot();
      if (after.emitted > before.emitted) {
        delivered += 1;
        marks.push(last(after.train).mark);
      }
    }
    expect(delivered).toBe(24);
    expect(marks[SEED_CORES - 1]).toBe("choke");
    expect(marks[23]).toBe("backflow");
    for (let i = SEED_CORES; i < 23; i += 1) expect(marks[i]).toBeNull();
  });

  it("names the marks of a level in the fixed cycle", () => {
    const hall = harness();
    const kinds: (string | null)[] = [];
    for (let ordinal = 1; ordinal <= 5; ordinal += 1) {
      hall.api.startLevel(5);
      // Wind the counter so the very next core the inlet places is the nth mark.
      hall.api.setQuotaRemaining(90 - ordinal * MARK_INTERVAL + 1);
      hall.api.clearTrain();
      hall.step();
      kinds.push(last(hall.api.snapshot().train).mark);
    }
    expect(kinds).toEqual(["choke", "backflow", "bore", "sightline", "choke"]);
  });

  it("restarts the count when a level restarts", () => {
    const hall = harness();
    hall.api.startLevel(2);
    expect(last(hall.api.snapshot().train).mark).toBe("choke");
    hall.api.startLevel(2);
    expect(last(hall.api.snapshot().train).mark).toBe("choke");
  });
});

describe("granting", () => {
  it("grants the machinery a marked core carries on the tick it is drawn out", () => {
    const hall = bare();
    const head = topLegS(430);
    seatShot(
      hall,
      [
        [head, "halide", null],
        [head - SPACING, "halide", "choke"],
        [head - 2 * SPACING, "cobalt", null],
      ],
      "halide",
    );
    expect(hall.api.snapshot().machinery).toMatchObject({ kind: "choke" });
    expect(hall.cues).toContain("machinery");
  });

  it("lets the mark nearest the tail decide what is left active", () => {
    const hall = bare();
    const head = topLegS(430);
    seatShot(
      hall,
      [
        [head, "halide", "choke"],
        [head - SPACING, "halide", "sightline"],
        [head - 2 * SPACING, "cobalt", null],
      ],
      "halide",
    );
    expect(hall.api.snapshot().machinery?.kind).toBe("sightline");
  });

  it("replaces whatever was running, at the full duration", () => {
    const hall = bare();
    hall.api.grantMachinery("choke");
    hall.step(60);
    expect(hall.api.snapshot().machinery?.remaining).toBeCloseTo(7, 1);
    hall.api.grantMachinery("sightline");
    const active = hall.api.snapshot().machinery;
    expect(active?.kind).toBe("sightline");
    expect(active?.remaining).toBeCloseTo(12, 6);
  });
});

describe("choke", () => {
  it("multiplies the feed speed by 0.4", () => {
    const hall = bare();
    hall.api.poseTrain([[1000, "halide", null]]);
    hall.api.setPressure(0);
    hall.api.grantMachinery("choke");
    hall.step(60);
    expect(hall.api.snapshot().train[0].s - 1000).toBeCloseTo(8.8, 1);
  });

  it("lapses after eight seconds, and the feed returns", () => {
    const hall = bare();
    hall.api.poseTrain([[500, "halide", null]]);
    hall.api.setPressure(0);
    hall.api.grantMachinery("choke");
    hall.step(481);
    expect(hall.api.snapshot().machinery).toBeNull();
    const before = hall.api.snapshot().train[0].s;
    hall.step(60);
    expect(hall.api.snapshot().train[0].s - before).toBeCloseTo(22, 1);
  });

  it("leaves the catch-up rate alone", () => {
    const hall = bare();
    hall.api.poseTrain([
      [2000, "halide", null],
      [1000, "cobalt", null],
    ]);
    hall.api.grantMachinery("choke");
    hall.step(30);
    expect(hall.api.snapshot().train[1].s - 1000).toBeCloseTo(90, 1);
  });
});

describe("backflow", () => {
  it("drives every core toward the inlet at 60 units a second", () => {
    const hall = bare();
    hall.api.poseTrain([
      [2000, "halide", null],
      [1972, "cobalt", null],
      [1944, "garnet", null],
    ]);
    hall.api.grantMachinery("backflow");
    hall.step(30);
    expect(hall.api.snapshot().train[0].s).toBeCloseTo(1970, 1);
  });

  it("stops the inlet while it runs, and starts it again when it ends", () => {
    const hall = bare();
    hall.api.startLevel(1);
    hall.api.clearTrain();
    hall.api.poseTrain([[500, "halide", null]]);
    hall.api.grantMachinery("backflow");
    hall.step(60);
    expect(hall.api.snapshot().train).toHaveLength(1);
    hall.step(300);
    expect(hall.api.snapshot().machinery).toBeNull();
    hall.step(2);
    expect(hall.api.snapshot().train.length).toBeGreaterThan(1);
  });
});

describe("bore", () => {
  it("clears every core within its radius of the extraction point", () => {
    const hall = bare();
    const head = topLegS(430);
    // A run of three halide whose middle core carries the mark, four cobalt behind
    // it, and a core a whole channel away that the blast cannot reach.
    seatShot(
      hall,
      [
        [head, "halide", null],
        [head - SPACING, "halide", "bore"],
        [head - 2 * SPACING, "cobalt", null],
        [head - 3 * SPACING, "cobalt", null],
        [head - 4 * SPACING, "cobalt", null],
        [1000, "garnet", null],
      ],
      "halide",
    );
    // The marked core rode one tick of feed and was shifted one spacing back to
    // make room for the seated core before its run was drawn out.
    const point = pointAt(head - 2 * SPACING + 22 / 60);
    const after = hall.api.snapshot();
    // Four cores survived the extraction; the bore took the one inside its reach.
    expect(after.train).toHaveLength(3);
    for (const core of after.train) {
      expect(Math.hypot(core.x - point.x, core.y - point.y)).toBeGreaterThan(
        BORE_RADIUS,
      );
    }
  });

  it("leaves a core beyond the radius standing", () => {
    const hall = bare();
    const head = topLegS(430);
    // The survivor stands on the same leg, 120 units of field beyond the mark.
    seatShot(
      hall,
      [
        [head, "halide", null],
        [head - SPACING, "halide", "bore"],
        [head - 2 * SPACING, "cobalt", null],
        [head - 300, "cobalt", null],
      ],
      "halide",
    );
    const after = hall.api.snapshot();
    expect(after.train).toHaveLength(1);
    const survivor = after.train[0];
    const mark = pointAt(head - SPACING);
    expect(
      Math.hypot(survivor.x - mark.x, survivor.y - mark.y),
    ).toBeGreaterThan(BORE_RADIUS);
  });

  it("never becomes the active machinery", () => {
    const hall = bare();
    hall.api.grantMachinery("sightline");
    const head = topLegS(430);
    seatShot(
      hall,
      [
        [head, "halide", null],
        [head - SPACING, "halide", "bore"],
        [head - 300, "cobalt", null],
      ],
      "halide",
    );
    // The sightline is untouched: a bore takes no slot and stops no clock.
    expect(hall.api.snapshot().machinery?.kind).toBe("sightline");
  });

  it("pays at the chain step in force, and carries the chain no further", () => {
    const hall = bare();
    const head = topLegS(430);
    const before = hall.api.snapshot();
    seatShot(
      hall,
      [
        [head, "halide", null],
        [head - SPACING, "halide", "bore"],
        // Standing one spacing behind the mark, so the bore reaches it.
        [head - 2 * SPACING, "cobalt", null],
        // 300 units of arc beyond it, so it does not.
        [head - 300, "cobalt", null],
      ],
      "halide",
    );
    const after = hall.api.snapshot();
    // The run of three at chain step 1, and then the one core the bore reached,
    // paid at the step the chain already stood at.
    expect(after.score - before.score).toBe(10 * 3 * 1 + 10 * 1 * 1);
    expect(after.chainStep).toBe(1);
    expect(after.train).toHaveLength(1);
  });
});
