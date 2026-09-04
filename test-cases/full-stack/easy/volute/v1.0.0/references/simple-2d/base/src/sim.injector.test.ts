// The injector under the tick: the aim, the cooldown, a shot's flight, and where
// it seats in the train.

import { describe, expect, it } from "vitest";
import {
  BINDINGS,
  FIRE_COOLDOWN,
  INJECTOR_X,
  INJECTOR_Y,
  SPACING,
} from "./constants";
import { bare, harness, last, seatShot, topLegS } from "./harness.test";

const LEFT = BINDINGS.left[0];
const RIGHT = BINDINGS.right[0];
const FIRE = BINDINGS.a[0];
const SWAP = BINDINGS.b[0];

describe("the aim", () => {
  it("opens straight up the field and keeps its value across a level change", async () => {
    const h = await harness();
    expect(h.api.snapshot().injector.aim).toBe(270);
    h.api.fireAt(123);
    h.api.startLevel(3);
    expect(h.api.snapshot().injector.aim).toBe(123);
    h.dispose();
  });

  it("points at a pointer position", async () => {
    const h = await bare();
    h.point(INJECTOR_X, INJECTOR_Y - 200);
    await h.step();
    expect(h.api.snapshot().injector.aim).toBeCloseTo(270, 6);
    h.point(INJECTOR_X + 300, INJECTOR_Y);
    await h.step();
    expect(h.api.snapshot().injector.aim).toBeCloseTo(0, 6);
    h.dispose();
  });

  it("leaves the aim alone for a pointer exactly on the injector", async () => {
    const h = await bare();
    h.api.fireAt(180);
    h.point(INJECTOR_X, INJECTOR_Y);
    await h.step();
    expect(h.api.snapshot().injector.aim).toBeCloseTo(180, 6);
    h.dispose();
  });

  it("swings counter-clockwise under the turn-left action", async () => {
    const h = await bare();
    h.api.fireAt(180);
    h.hold(LEFT);
    await h.step(30);
    expect(h.api.snapshot().injector.aim).toBeCloseTo(90, 1);
    h.dispose();
  });

  it("swings clockwise under the turn-right action", async () => {
    const h = await bare();
    h.api.fireAt(180);
    h.hold(RIGHT);
    await h.step(30);
    expect(h.api.snapshot().injector.aim).toBeCloseTo(270, 1);
    h.dispose();
  });

  it("turns by nothing with both held", async () => {
    const h = await bare();
    h.api.fireAt(180);
    h.hold(LEFT);
    h.hold(RIGHT);
    await h.step(30);
    expect(h.api.snapshot().injector.aim).toBeCloseTo(180, 6);
    h.dispose();
  });

  it("wraps continuously through a full turn", async () => {
    const h = await bare();
    h.api.fireAt(10);
    h.hold(LEFT);
    await h.step(10);
    const aim = h.api.snapshot().injector.aim;
    expect(aim).toBeGreaterThan(0);
    expect(aim).toBeLessThan(360);
    expect(aim).toBeCloseTo(340, 1);
    h.dispose();
  });

  it("holds the aim still while the hall is paused", async () => {
    const h = await bare();
    h.api.fireAt(180);
    h.api.pause();
    h.hold(LEFT);
    await h.step(30);
    expect(h.api.snapshot().injector.aim).toBeCloseTo(180, 6);
    h.dispose();
  });
});

describe("firing", () => {
  it("launches along the aim and sets the cooldown", async () => {
    const h = await bare();
    h.api.setLoaded("cobalt");
    h.api.fireAt(270);
    const shot = h.api.snapshot();
    expect(shot.projectiles).toHaveLength(1);
    expect(shot.projectiles[0]).toMatchObject({
      x: INJECTOR_X,
      y: INJECTOR_Y,
      angle: 270,
      charge: "cobalt",
    });
    expect(shot.injector.cooldown).toBeCloseTo(FIRE_COOLDOWN, 6);
    h.dispose();
  });

  it("refuses the fire control inside the cooldown, and sounds the refusal", async () => {
    const h = await bare();
    h.api.fireAt(270);
    await h.step(10);
    const marker = h.cues.length;
    h.tap(FIRE);
    await h.step();
    expect(h.api.snapshot().projectiles).toHaveLength(1);
    expect(h.since(marker)).toContain("denied");
    h.dispose();
  });

  it("honors the fire control once the cooldown has run out", async () => {
    const h = await bare();
    h.api.fireAt(270);
    await h.step(11);
    h.tap(FIRE);
    await h.step();
    expect(h.api.snapshot().projectiles.length).toBeGreaterThanOrEqual(1);
    expect(h.cues.map((play) => play.cue)).toContain("fire");
    h.dispose();
  });

  it("fires from a pointer press, along the aim the pointer set", async () => {
    const h = await bare();
    h.click(INJECTOR_X + 200, INJECTOR_Y);
    await h.step();
    const shot = h.api.snapshot();
    expect(shot.projectiles).toHaveLength(1);
    expect(shot.projectiles[0].angle).toBeCloseTo(0, 6);
    h.dispose();
  });

  it("moves the queued charge into the loaded slot on firing", async () => {
    const h = await bare();
    h.api.setLoaded("halide");
    h.api.setQueued("garnet");
    h.api.fireAt(270);
    expect(h.api.snapshot().injector.loaded).toBe("garnet");
    expect(h.api.snapshot().injector.queued).not.toBeNull();
    h.dispose();
  });

  it("exchanges the loaded and queued charges on the swap control", async () => {
    const h = await bare();
    h.api.setLoaded("halide");
    h.api.setQueued("cobalt");
    h.tap(SWAP);
    await h.step();
    expect(h.api.snapshot().injector).toMatchObject({
      loaded: "cobalt",
      queued: "halide",
    });
    expect(h.cues.map((play) => play.cue)).toContain("swap");
    h.dispose();
  });

  it("swaps whether or not the cooldown has run out", async () => {
    const h = await bare();
    h.api.fireAt(270);
    h.api.setLoaded("halide");
    h.api.setQueued("cobalt");
    h.tap(SWAP);
    await h.step();
    expect(h.api.snapshot().injector).toMatchObject({
      loaded: "cobalt",
      queued: "halide",
    });
    h.dispose();
  });

  it("flies 620 units a second in a straight line", async () => {
    const h = await bare();
    h.api.fireAt(270);
    await h.step(30);
    const shot = h.api.snapshot().projectiles[0];
    expect(Math.hypot(shot.x - INJECTOR_X, shot.y - INJECTOR_Y)).toBeCloseTo(
      310,
      3,
    );
    expect(shot.x).toBeCloseTo(INJECTOR_X, 6);
    expect(shot.y).toBeLessThan(INJECTOR_Y);
    h.dispose();
  });

  it("discards a shot whose center leaves the field", async () => {
    const h = await bare();
    h.api.fireAt(270);
    await h.step(60);
    expect(h.api.snapshot().projectiles).toHaveLength(0);
    h.dispose();
  });

  it("keeps several shots in flight at once, each independent", async () => {
    const h = await bare();
    h.api.fireAt(260);
    await h.step(6);
    h.api.fireAt(280);
    expect(h.api.snapshot().projectiles).toHaveLength(2);
    await h.step(4);
    const [first, second] = h.api.snapshot().projectiles;
    expect(first.angle).toBe(260);
    expect(second.angle).toBe(280);
    h.dispose();
  });
});

describe("seating a shot", () => {
  it("seats once the centers come within the strike distance", async () => {
    const h = await bare();
    // Twenty units clear of the shot's path, comfortably inside the 28-unit
    // window.
    await seatShot(h, [[topLegS(440), "halide", null]]);
    const shot = h.api.snapshot();
    expect(shot.projectiles).toHaveLength(0);
    expect(shot.train).toHaveLength(2);
    expect(h.cues.map((play) => play.cue)).toContain("seat");
    h.dispose();
  });

  it("passes a core it never comes within the strike distance of", async () => {
    const h = await bare();
    await seatShot(h, [[topLegS(449), "halide", null]]);
    await h.step(20);
    expect(h.api.snapshot().train).toHaveLength(1);
    h.dispose();
  });

  it("seats ahead of a core it arrives in front of", async () => {
    const h = await bare();
    const at = topLegS(410);
    await seatShot(h, [[at, "halide", null]]);
    const train = h.api.snapshot().train;
    expect(train).toHaveLength(2);
    expect(train[0].charge).toBe("cobalt");
    expect(train[0].s).toBeGreaterThan(train[1].s);
    expect(train[0].s).toBeCloseTo(at + 22 / 60, 1);
    h.dispose();
  });

  it("seats behind a core it arrives behind", async () => {
    const h = await bare();
    const at = topLegS(430);
    await seatShot(h, [[at, "halide", null]]);
    const train = h.api.snapshot().train;
    expect(train).toHaveLength(2);
    expect(train[1].charge).toBe("cobalt");
    expect(train[0].charge).toBe("halide");
    expect(train[1].s).toBeCloseTo(at + 22 / 60 - SPACING, 1);
    h.dispose();
  });

  it("strikes the nearer of two cores in reach", async () => {
    const h = await bare();
    // Two cores 42 apart, with a decoy far ahead so both ride at the catch-up
    // rate. The shot arrives 18 from the rear core's center and 24 from the
    // front core's.
    const catchup = 180 / 60;
    const rear = topLegS(402) - catchup;
    await seatShot(h, [
      [4900, "olivine", null],
      [rear + 42, "halide", null],
      [rear, "halide", null],
    ]);
    const train = h.api.snapshot().train;
    expect(train).toHaveLength(4);
    // Seated at the rear core's own slot, not the slot 14 ahead of it.
    expect(train[2].charge).toBe("cobalt");
    expect(train[2].s).toBeCloseTo(topLegS(402), 3);
    h.dispose();
  });

  it("breaks a tie toward the core with the larger arc position", async () => {
    const h = await bare();
    // The shot arrives on the perpendicular bisector of a pair 42 apart, so the
    // two center distances are equal and the core with the larger arc position
    // takes it.
    const catchup = 180 / 60;
    const rear = topLegS(399) - catchup;
    await seatShot(h, [
      [4900, "olivine", null],
      [rear + 42, "halide", null],
      [rear, "halide", null],
    ]);
    const train = h.api.snapshot().train;
    expect(train).toHaveLength(4);
    expect(train[2].charge).toBe("cobalt");
    // The slot behind the forward core, which is 14 ahead of the rear core.
    expect(train[2].s).toBeCloseTo(topLegS(441) - SPACING, 3);
    h.dispose();
  });

  it("shifts the train back to make room, and never moves the head", async () => {
    const h = await bare();
    const head = topLegS(420 + 56);
    await seatShot(h, [
      [head, "halide", null],
      [head - 28, "halide", null],
      [head - 56, "halide", null],
      [head - 84, "garnet", null],
      [head - 112, "garnet", null],
    ]);
    const train = h.api.snapshot().train;
    expect(train).toHaveLength(6);
    // The head kept its arc position but for the one tick of feed the strike
    // took.
    expect(train[0].s).toBeCloseTo(head + 22 / 60, 1);
    expect(last(train).s).toBeCloseTo(head - 112 + 22 / 60 - SPACING, 1);
    h.dispose();
  });
});
