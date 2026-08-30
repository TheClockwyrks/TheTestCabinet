// The injector (specs/injector.md, specs/controls.md): where it aims, what it
// fires, how a fired core flies, which core it strikes, and where that core
// seats.
//
// The insertion checks fire DOWN onto the channel's leg at `y = 420`, whose
// forward direction is `-x`. That leg is 90 units below the injector, so a shot
// reaches it in 0.145 s and the train drifts barely three units while it flies —
// which is what makes "the side the shot arrived on" a statement about the shot
// rather than about the flight time.

import { describe, expect, it } from "vitest";
import { FIRE_COOLDOWN, INJECTOR_X, INJECTOR_Y, SPACING } from "./constants";
import { findStrike } from "./train";
import {
  current,
  isolate,
  openLevel,
  poseTrain,
  run,
  useHarness,
} from "./harness";

useHarness();

/** The arc position of the point `(x, 420)` on the leg the shots aim at. */
function onLowerLeg(x: number): number {
  return 3540 + (840 - x);
}

/** The angle from the injector toward a point, in degrees. */
function toward(x: number, y: number): number {
  return (Math.atan2(y - INJECTOR_Y, x - INJECTOR_X) * 180) / Math.PI;
}

describe("aiming", () => {
  it("aims at the pointer", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [[1300, "halide", null]]);

    h.point(420, 130);
    await h.engine.advance(1);
    expect(h.snapshot().injector.aim).toBeCloseTo(270, 6);

    h.point(720, 330);
    await h.engine.advance(1);
    expect(h.snapshot().injector.aim).toBeCloseTo(0, 6);
  });

  it("leaves the aim alone for a pointer on the injector's own center", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [[1300, "halide", null]]);
    h.debug.fire(180);
    h.point(INJECTOR_X, INJECTOR_Y);
    await h.engine.advance(1);
    expect(h.snapshot().injector.aim).toBeCloseTo(180, 6);
  });

  it("swings the aim counter-clockwise under the left turn", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [[1300, "halide", null]]);
    h.debug.fire(180);
    h.hold("ArrowLeft");
    await h.engine.advance(30);
    expect(h.snapshot().injector.aim).toBeCloseTo(90, 4);
  });

  it("swings the aim clockwise under the right turn", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [[1300, "halide", null]]);
    h.debug.fire(180);
    h.hold("ArrowRight");
    await h.engine.advance(30);
    expect(h.snapshot().injector.aim).toBeCloseTo(270, 4);
  });

  it("turns by nothing with both turns held", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [[1300, "halide", null]]);
    h.debug.fire(180);
    h.hold("ArrowLeft");
    h.hold("ArrowRight");
    await h.engine.advance(30);
    expect(h.snapshot().injector.aim).toBeCloseTo(180, 6);
  });
});

describe("firing", () => {
  it("refuses a second shot inside the cooldown, and honors one after it", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [[1300, "halide", null]]);

    h.debug.fire(270);
    expect(h.snapshot().injector.cooldown).toBeCloseTo(FIRE_COOLDOWN, 6);
    await h.engine.advance(10);

    h.tap("Space");
    await h.engine.advance(1);
    expect(h.snapshot().projectiles).toHaveLength(1);
    expect(h.cues.map((play) => play.cue)).toContain("denied");

    await h.engine.advance(2);
    h.tap("Space");
    await h.engine.advance(1);
    expect(h.snapshot().projectiles).toHaveLength(2);
  });

  it("flies a fired core at its stated speed along the angle it was fired at", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [[1300, "halide", null]]);
    h.debug.fire(270);
    await h.engine.advance(30);
    const shot = h.snapshot().projectiles[0];
    expect(shot.angle).toBeCloseTo(270, 6);
    expect(Math.hypot(shot.x - INJECTOR_X, shot.y - INJECTOR_Y)).toBeCloseTo(
      310,
      3,
    );
    expect(shot.x).toBeCloseTo(INJECTOR_X, 6);
    expect(shot.y).toBeLessThan(INJECTOR_Y);
  });

  it("discards a core whose center leaves the field", async () => {
    const h = current();
    await openLevel(h, 1);
    h.debug.clearTrain();
    h.debug.fire(270);
    await h.engine.advance(60);
    expect(h.snapshot().projectiles).toEqual([]);
  });

  it("moves the queued charge into the loaded slot on firing", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [[1300, "halide", null]]);
    h.debug.setLoaded("halide");
    h.debug.setQueued("cobalt");
    h.debug.fire(270);
    const shot = h.snapshot();
    expect(shot.projectiles[0].charge).toBe("halide");
    expect(shot.injector.loaded).toBe("cobalt");
    expect(shot.injector.queued).not.toBeNull();
  });

  it("exchanges the loaded and queued charges on the swap control", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [[1300, "halide", null]]);
    h.debug.setLoaded("halide");
    h.debug.setQueued("cobalt");
    h.tap("KeyX");
    await h.engine.advance(1);
    expect(h.snapshot().injector.loaded).toBe("cobalt");
    expect(h.snapshot().injector.queued).toBe("halide");
  });
});

describe("striking a core", () => {
  it("seats a shot that comes within the strike distance", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [[onLowerLeg(420), "halide", null]]);
    h.debug.setLoaded("cobalt");
    h.debug.fire(90);
    await h.engine.advance(12);
    expect(h.snapshot().projectiles).toEqual([]);
    expect(h.snapshot().train).toHaveLength(2);
  });

  it("passes a shot whose closest approach stays beyond it", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [[onLowerLeg(300), "halide", null]]);
    h.debug.setLoaded("cobalt");
    h.debug.fire(90);
    await h.engine.advance(12);
    expect(h.snapshot().train).toHaveLength(1);
  });

  it("seats ahead of the core a shot arrived in front of", async () => {
    const h = current();
    await isolate(h);
    const at = onLowerLeg(420);
    poseTrain(h, [[at, "halide", null]]);
    // The leg runs toward `-x`, so a shot landing at smaller x arrives in front.
    h.debug.setLoaded("cobalt");
    h.debug.fire(toward(400, 420));
    await h.engine.advance(14);

    const train = h.snapshot().train;
    expect(train).toHaveLength(2);
    const seated = train.find((core) => core.charge === "cobalt");
    const struck = train.find((core) => core.charge === "halide");
    expect(seated?.s).toBeGreaterThan(struck!.s);
  });

  it("seats behind the core a shot arrived behind", async () => {
    const h = current();
    await isolate(h);
    const at = onLowerLeg(420);
    poseTrain(h, [[at, "halide", null]]);
    h.debug.setLoaded("cobalt");
    h.debug.fire(toward(440, 420));
    await h.engine.advance(14);

    const train = h.snapshot().train;
    expect(train).toHaveLength(2);
    const seated = train.find((core) => core.charge === "cobalt");
    const struck = train.find((core) => core.charge === "halide");
    expect(seated!.s).toBeLessThan(struck!.s);
  });

  it("shifts the train back by one spacing around a seated core", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, run(onLowerLeg(300), 5, "halide"));
    h.debug.setLoaded("cobalt");

    // Land the shot beside the third core of the five.
    const third = h.snapshot().train[2].s;
    const x = 840 - (third - 3540);
    h.debug.fire(toward(x + 20, 420));

    let before = h.snapshot().train;
    let after = before;
    for (let i = 0; i < 20; i += 1) {
      before = h.snapshot().train;
      await h.engine.advance(1);
      after = h.snapshot().train;
      if (after.length === 6) break;
    }
    expect(after).toHaveLength(6);

    const headMoved = after[0].s - before[0].s;
    const tailMoved = after[after.length - 1].s - before[before.length - 1].s;
    expect(headMoved - tailMoved).toBeCloseTo(SPACING, 6);
  });

  it("strikes the nearest core, and breaks a tie toward the head", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [
      [onLowerLeg(400), "halide", null],
      [onLowerLeg(442), "cobalt", null],
    ]);
    const cores = h.cores();
    // The leg runs toward `-x`, so the core at the smaller x carries the larger
    // arc position and leads the train.
    expect(cores[0].charge).toBe("halide");
    expect(cores[0].s - cores[1].s).toBeCloseTo(42, 6);

    // Nearer the head.
    expect(findStrike(cores, { x: 404, y: 420 })?.index).toBe(0);
    // Nearer the trailing core.
    expect(findStrike(cores, { x: 438, y: 420 })?.index).toBe(1);
    // Equidistant: the larger arc position wins, which is the head.
    expect(findStrike(cores, { x: 421, y: 420 })?.index).toBe(0);
    // Beyond reach of either.
    expect(findStrike(cores, { x: 421, y: 470 })).toBeNull();
  });
});
