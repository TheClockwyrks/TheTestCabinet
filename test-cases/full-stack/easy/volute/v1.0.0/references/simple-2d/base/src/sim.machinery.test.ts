// The four machinery kinds: the cadence that places a mark, the cycle that names
// it, the grant that fires it, and each effect on its own.

import { describe, expect, it } from "vitest";
import { BORE_RADIUS, MARK_INTERVAL, SEEDED_CORES, SPACING } from "./constants";
import { pointAt } from "./channel";
import { bare, harness, last, seatShot, topLegS } from "./harness.test";

describe("marks", () => {
  it("marks the twelfth core of a level, and none of the eleven before it", async () => {
    const h = await harness();
    h.api.startLevel(1);
    const train = h.api.snapshot().train;
    expect(last(train).mark).toBe("choke");
    for (const core of train.slice(0, SEEDED_CORES - 1)) {
      expect(core.mark).toBeNull();
    }
    h.dispose();
  });

  it("marks every twelfth core the level delivers", async () => {
    const h = await harness();
    h.api.startLevel(1);
    const marks: (string | null)[] = h.api
      .snapshot()
      .train.map((core) => core.mark);

    let delivered = SEEDED_CORES;
    for (let i = 0; i < 4000 && delivered < 24; i += 1) {
      const before = h.api.snapshot();
      await h.step();
      const after = h.api.snapshot();
      if (after.emitted > before.emitted) {
        delivered += 1;
        marks.push(last(after.train).mark);
      }
    }
    expect(delivered).toBe(24);
    expect(marks[SEEDED_CORES - 1]).toBe("choke");
    expect(marks[23]).toBe("backflow");
    for (let i = SEEDED_CORES; i < 23; i += 1) expect(marks[i]).toBeNull();
    h.dispose();
  });

  it("names the marks of a level in the fixed cycle", async () => {
    const h = await harness();
    const kinds: (string | null)[] = [];
    for (let ordinal = 1; ordinal <= 5; ordinal += 1) {
      h.api.startLevel(5);
      // Wind the counter so the very next core the inlet places is the nth mark.
      h.api.setQuotaRemaining(90 - ordinal * MARK_INTERVAL + 1);
      h.api.clearTrain();
      await h.step();
      kinds.push(last(h.api.snapshot().train).mark);
    }
    expect(kinds).toEqual(["choke", "backflow", "bore", "sightline", "choke"]);
    h.dispose();
  });

  it("restarts the count when a level restarts", async () => {
    const h = await harness();
    h.api.startLevel(2);
    expect(last(h.api.snapshot().train).mark).toBe("choke");
    h.api.startLevel(2);
    expect(last(h.api.snapshot().train).mark).toBe("choke");
    h.dispose();
  });
});

describe("granting", () => {
  it("grants the machinery a marked core carries on the tick it is drawn out", async () => {
    const h = await bare();
    const head = topLegS(430);
    await seatShot(
      h,
      [
        [head, "halide", null],
        [head - SPACING, "halide", "choke"],
        [head - 2 * SPACING, "cobalt", null],
      ],
      "halide",
    );
    expect(h.api.snapshot().machinery).toMatchObject({ kind: "choke" });
    expect(h.cues.map((play) => play.cue)).toContain("machinery");
    h.dispose();
  });

  it("lets the mark nearest the tail decide what is left active", async () => {
    const h = await bare();
    const head = topLegS(430);
    await seatShot(
      h,
      [
        [head, "halide", "choke"],
        [head - SPACING, "halide", "sightline"],
        [head - 2 * SPACING, "cobalt", null],
      ],
      "halide",
    );
    expect(h.api.snapshot().machinery?.kind).toBe("sightline");
    h.dispose();
  });

  it("replaces whatever was running, at the full duration", async () => {
    const h = await bare();
    h.api.grantMachinery("choke");
    await h.step(60);
    expect(h.api.snapshot().machinery?.remaining).toBeCloseTo(7, 1);
    h.api.grantMachinery("sightline");
    const active = h.api.snapshot().machinery;
    expect(active?.kind).toBe("sightline");
    expect(active?.remaining).toBeCloseTo(12, 6);
    h.dispose();
  });

  it("grants nothing for a marked core a bore removes", async () => {
    const h = await bare();
    h.api.poseTrain([
      [1000, "halide", null],
      [972, "halide", null],
      [944, "halide", null],
      [916, "cobalt", "sightline"],
    ]);
    h.api.grantMachinery("bore");
    // The bore took all four, the marked one included, and nothing is running.
    expect(h.api.snapshot().train).toHaveLength(0);
    expect(h.api.snapshot().machinery).toBeNull();
    h.dispose();
  });
});

describe("choke", () => {
  it("multiplies the feed speed by 0.4", async () => {
    const h = await bare();
    h.api.poseTrain([[1000, "halide", null]]);
    h.api.setPressure(0);
    h.api.grantMachinery("choke");
    await h.step(60);
    expect(h.api.snapshot().train[0].s - 1000).toBeCloseTo(8.8, 1);
    h.dispose();
  });

  it("lapses after eight seconds, and the feed returns", async () => {
    const h = await bare();
    h.api.poseTrain([[500, "halide", null]]);
    h.api.setPressure(0);
    h.api.grantMachinery("choke");
    await h.step(481);
    expect(h.api.snapshot().machinery).toBeNull();
    const before = h.api.snapshot().train[0].s;
    await h.step(60);
    expect(h.api.snapshot().train[0].s - before).toBeCloseTo(22, 1);
    h.dispose();
  });

  it("leaves the catch-up rate alone", async () => {
    const h = await bare();
    h.api.poseTrain([
      [2000, "halide", null],
      [1000, "cobalt", null],
    ]);
    h.api.grantMachinery("choke");
    await h.step(30);
    expect(h.api.snapshot().train[1].s - 1000).toBeCloseTo(90, 1);
    h.dispose();
  });
});

describe("backflow", () => {
  it("drives every core toward the inlet at 60 units a second", async () => {
    const h = await bare();
    h.api.poseTrain([
      [2000, "halide", null],
      [1972, "cobalt", null],
      [1944, "garnet", null],
    ]);
    h.api.grantMachinery("backflow");
    await h.step(30);
    expect(h.api.snapshot().train[0].s).toBeCloseTo(1970, 1);
    h.dispose();
  });

  it("packs the train against the inlet and holds it there", async () => {
    const h = await bare();
    // Each core has less than the 300 units of travel backflow's five seconds
    // buy, so all three reach their packed places and hold there.
    h.api.poseTrain([
      [200, "halide", null],
      [150, "cobalt", null],
      [100, "garnet", null],
    ]);
    h.api.grantMachinery("backflow");
    await h.step(180);
    const train = h.api.snapshot().train;
    expect(last(train).s).toBeCloseTo(0, 6);
    expect(train[1].s).toBeCloseTo(SPACING, 6);
    expect(train[0].s).toBeCloseTo(2 * SPACING, 6);
    h.dispose();
  });

  it("leaves a core standing below the inlet where it stands", async () => {
    const h = await bare();
    // An insertion's shift can carry a position below zero; such a core is drawn
    // at the inlet and backflow does not drive it further back.
    h.api.poseTrain([
      [100, "halide", null],
      [-20, "cobalt", null],
    ]);
    h.api.grantMachinery("backflow");
    await h.step(60);
    const train = h.api.snapshot().train;
    expect(train[1].s).toBe(-20);
    expect(train[1].x).toBe(40);
    expect(train[1].y).toBe(40);
    h.dispose();
  });

  it("stops the inlet while it runs, and starts it again when it ends", async () => {
    const h = await bare();
    h.api.startLevel(1);
    h.api.clearTrain();
    h.api.poseTrain([[500, "halide", null]]);
    h.api.grantMachinery("backflow");
    await h.step(60);
    expect(h.api.snapshot().train).toHaveLength(1);
    await h.step(300);
    expect(h.api.snapshot().machinery).toBeNull();
    await h.step(2);
    expect(h.api.snapshot().train.length).toBeGreaterThan(1);
    h.dispose();
  });
});

describe("bore", () => {
  it("clears every core within its radius of the extraction point", async () => {
    const h = await bare();
    const head = topLegS(430);
    // A run of three halide whose middle core carries the mark, cobalt behind it,
    // and a core a whole channel away that the blast cannot reach.
    await seatShot(
      h,
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
    const after = h.api.snapshot();
    expect(after.train).toHaveLength(3);
    for (const core of after.train) {
      expect(Math.hypot(core.x - point.x, core.y - point.y)).toBeGreaterThan(
        BORE_RADIUS,
      );
    }
    h.dispose();
  });

  it("leaves a core beyond the radius standing", async () => {
    const h = await bare();
    const head = topLegS(430);
    await seatShot(
      h,
      [
        [head, "halide", null],
        [head - SPACING, "halide", "bore"],
        [head - 2 * SPACING, "cobalt", null],
        [head - 300, "cobalt", null],
      ],
      "halide",
    );
    const after = h.api.snapshot();
    expect(after.train).toHaveLength(1);
    const survivor = after.train[0];
    const mark = pointAt(head - SPACING);
    expect(
      Math.hypot(survivor.x - mark.x, survivor.y - mark.y),
    ).toBeGreaterThan(BORE_RADIUS);
    h.dispose();
  });

  it("never becomes the active machinery", async () => {
    const h = await bare();
    h.api.grantMachinery("sightline");
    h.api.poseTrain([[1000, "halide", null]]);
    h.api.grantMachinery("bore");
    expect(h.api.snapshot().machinery?.kind).toBe("sightline");
    expect(h.api.snapshot().train).toHaveLength(0);
    h.dispose();
  });

  it("removes nothing and scores nothing on an empty channel", async () => {
    const h = await bare();
    h.api.clearTrain();
    const before = h.api.snapshot().score;
    h.api.grantMachinery("bore");
    expect(h.api.snapshot().score).toBe(before);
    h.dispose();
  });

  it("pays at the chain step in force, and carries the chain no further", async () => {
    const h = await bare();
    h.api.poseTrain([
      [1000, "halide", null],
      [972, "halide", null],
      [944, "halide", null],
    ]);
    const before = h.api.snapshot();
    h.api.grantMachinery("bore");
    const after = h.api.snapshot();
    expect(after.score - before.score).toBe(10 * 3 * 1);
    expect(after.chainStep).toBe(1);
    expect(after.chainTimer).toBe(before.chainTimer);
    h.dispose();
  });
});

describe("sightline", () => {
  it("is the only one of the three that can be active at a time", async () => {
    const h = await bare();
    h.api.grantMachinery("choke");
    expect(h.api.snapshot().machinery?.kind).toBe("choke");
    h.api.grantMachinery("backflow");
    expect(h.api.snapshot().machinery?.kind).toBe("backflow");
    h.api.grantMachinery("sightline");
    const active = h.api.snapshot().machinery;
    expect(active?.kind).toBe("sightline");
    expect(active?.remaining).toBeCloseTo(12, 6);
    h.dispose();
  });

  it("runs for twelve seconds and then lapses", async () => {
    const h = await bare();
    h.api.grantMachinery("sightline");
    await h.step(719);
    expect(h.api.snapshot().machinery?.kind).toBe("sightline");
    await h.step(2);
    expect(h.api.snapshot().machinery).toBeNull();
    h.dispose();
  });
});
