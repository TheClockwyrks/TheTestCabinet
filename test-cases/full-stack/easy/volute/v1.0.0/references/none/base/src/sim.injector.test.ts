// The injector under the tick: the aim, the cooldown, a shot's flight, and where
// it seats in the train.

import { describe, expect, it } from "vitest";
import { FIRE_COOLDOWN, INJECTOR_X, INJECTOR_Y, SPACING } from "./constants";
import { harness, last, seatShot, topLegS } from "./harness.test";

/**
 * A hall on level 1 with the inlet spent and one core parked out of the way, near
 * the inlet end of the straight top run.
 *
 * The core is deliberate: a channel that is EMPTY while the quota is spent is a
 * cleared level (specs/channel.md, step 6), and a cleared level advances nothing
 * but its own interlude — so a scenario that wants the hall to keep running has to
 * leave something on the channel. At `s = 100` it stands at `(140, 40)`, hundreds
 * of units clear of every shot fired below.
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

describe("the aim", () => {
  it("opens straight up the field and keeps its value across a level change", () => {
    const hall = harness();
    expect(hall.api.snapshot().injector.aim).toBe(270);
    hall.api.setAim(123);
    hall.api.fire();
    hall.api.startLevel(3);
    expect(hall.api.snapshot().injector.aim).toBe(123);
  });

  it("points at a pointer position", () => {
    const hall = bare();
    hall.point(INJECTOR_X, INJECTOR_Y - 200);
    hall.step();
    expect(hall.api.snapshot().injector.aim).toBeCloseTo(270, 6);
    hall.point(INJECTOR_X + 300, INJECTOR_Y);
    hall.step();
    expect(hall.api.snapshot().injector.aim).toBeCloseTo(0, 6);
  });

  it("leaves the aim alone for a pointer exactly on the injector", () => {
    const hall = bare();
    hall.api.setAim(180);
    hall.api.fire();
    hall.point(INJECTOR_X, INJECTOR_Y);
    hall.step();
    expect(hall.api.snapshot().injector.aim).toBeCloseTo(180, 6);
  });

  it("swings counter-clockwise under the turn-left action", () => {
    const hall = bare();
    hall.api.setAim(180);
    hall.api.fire();
    hall.hold("left");
    hall.step(30);
    expect(hall.api.snapshot().injector.aim).toBeCloseTo(90, 1);
  });

  it("swings clockwise under the turn-right action", () => {
    const hall = bare();
    hall.api.setAim(180);
    hall.api.fire();
    hall.hold("right");
    hall.step(30);
    expect(hall.api.snapshot().injector.aim).toBeCloseTo(270, 1);
  });

  it("turns by nothing with both held", () => {
    const hall = bare();
    hall.api.setAim(180);
    hall.api.fire();
    hall.hold("left");
    hall.hold("right");
    hall.step(30);
    expect(hall.api.snapshot().injector.aim).toBeCloseTo(180, 6);
  });

  it("wraps continuously through a full turn", () => {
    const hall = bare();
    hall.api.setAim(10);
    hall.api.fire();
    hall.hold("left");
    hall.step(10);
    const aim = hall.api.snapshot().injector.aim;
    expect(aim).toBeGreaterThan(0);
    expect(aim).toBeLessThan(360);
    expect(aim).toBeCloseTo(340, 1);
  });
});

describe("firing", () => {
  it("launches along the aim and sets the cooldown", () => {
    const hall = bare();
    hall.api.setLoaded("cobalt");
    hall.api.setAim(270);
    hall.api.fire();
    const shot = hall.api.snapshot();
    expect(shot.projectiles).toHaveLength(1);
    expect(shot.projectiles[0]).toMatchObject({
      x: INJECTOR_X,
      y: INJECTOR_Y,
      angle: 270,
      charge: "cobalt",
    });
    expect(shot.injector.cooldown).toBeCloseTo(FIRE_COOLDOWN, 6);
  });

  it("refuses the fire control inside the cooldown, and sounds the refusal", () => {
    const hall = bare();
    hall.api.setAim(270);
    hall.api.fire();
    hall.step(10);
    const marker = hall.cues.length;
    hall.press("fire");
    hall.step();
    expect(hall.api.snapshot().projectiles).toHaveLength(1);
    expect(hall.since(marker)).toContain("denied");
  });

  it("honors the fire control once the cooldown has run out", () => {
    const hall = bare();
    hall.api.setAim(270);
    hall.api.fire();
    hall.step(11);
    hall.press("fire");
    hall.step();
    expect(hall.api.snapshot().projectiles.length).toBeGreaterThanOrEqual(1);
    expect(hall.cues).toContain("fire");
  });

  it("moves the queued charge into the loaded slot on firing", () => {
    const hall = bare();
    hall.api.setLoaded("halide");
    hall.api.setQueued("garnet");
    hall.api.setAim(270);
    hall.api.fire();
    expect(hall.api.snapshot().injector.loaded).toBe("garnet");
    expect(hall.api.snapshot().injector.queued).not.toBeNull();
  });

  it("exchanges the loaded and queued charges on the swap control", () => {
    const hall = bare();
    hall.api.setLoaded("halide");
    hall.api.setQueued("cobalt");
    hall.press("swap");
    hall.step();
    expect(hall.api.snapshot().injector).toMatchObject({
      loaded: "cobalt",
      queued: "halide",
    });
    expect(hall.cues).toContain("swap");
  });

  it("flies 620 units a second in a straight line", () => {
    const hall = bare();
    hall.api.setAim(270);
    hall.api.fire();
    hall.step(30);
    const shot = hall.api.snapshot().projectiles[0];
    expect(Math.hypot(shot.x - INJECTOR_X, shot.y - INJECTOR_Y)).toBeCloseTo(
      310,
      3,
    );
    expect(shot.x).toBeCloseTo(INJECTOR_X, 6);
    expect(shot.y).toBeLessThan(INJECTOR_Y);
  });

  it("discards a shot whose center leaves the field", () => {
    const hall = bare();
    hall.api.setAim(270);
    hall.api.fire();
    hall.step(60);
    expect(hall.api.snapshot().projectiles).toHaveLength(0);
  });

  it("keeps several shots in flight at once, each independent", () => {
    const hall = bare();
    hall.api.setAim(260);
    hall.api.fire();
    hall.step(6);
    hall.api.setAim(280);
    hall.api.fire();
    expect(hall.api.snapshot().projectiles).toHaveLength(2);
    hall.step(4);
    const [first, second] = hall.api.snapshot().projectiles;
    expect(first.angle).toBe(260);
    expect(second.angle).toBe(280);
  });
});

describe("seating a shot", () => {
  /** A hall with the inlet spent and one core parked far from the shot's path. */
  function ready() {
    const hall = bare();
    return hall;
  }

  it("seats once the centers come within the strike distance", () => {
    const hall = ready();
    // Twenty units clear of the shot's path, comfortably inside the 28-unit window.
    seatShot(hall, [[topLegS(440), "halide", null]]);
    const shot = hall.api.snapshot();
    expect(shot.projectiles).toHaveLength(0);
    expect(shot.train).toHaveLength(2);
    expect(hall.cues).toContain("seat");
  });

  it("passes a core it never comes within the strike distance of", () => {
    const hall = ready();
    seatShot(hall, [[topLegS(449), "halide", null]]);
    hall.step(20);
    expect(hall.api.snapshot().train).toHaveLength(1);
  });

  it("seats ahead of a core it arrives in front of", () => {
    const hall = ready();
    const at = topLegS(410);
    seatShot(hall, [[at, "halide", null]]);
    const train = hall.api.snapshot().train;
    expect(train).toHaveLength(2);
    expect(train[0].charge).toBe("cobalt");
    expect(train[0].s).toBeGreaterThan(train[1].s);
    expect(train[0].s).toBeCloseTo(at + 22 / 60, 1);
  });

  it("seats behind a core it arrives behind", () => {
    const hall = ready();
    const at = topLegS(430);
    seatShot(hall, [[at, "halide", null]]);
    const train = hall.api.snapshot().train;
    expect(train).toHaveLength(2);
    expect(train[1].charge).toBe("cobalt");
    expect(train[0].charge).toBe("halide");
    expect(train[1].s).toBeCloseTo(at + 22 / 60 - SPACING, 1);
  });

  it("strikes the nearer of two cores in reach", () => {
    const hall = ready();
    // Two cores one 42 apart, where the two possible answers stand 28 units apart,
    // and a decoy far ahead so both of them ride at the catch-up rate and their
    // positions at the strike are symmetric about the pose. The shot arrives 18
    // from the rear core's center and 24 from the front core's.
    const catchup = 180 / 60;
    const rear = topLegS(402) - catchup;
    seatShot(hall, [
      [4900, "olivine", null],
      [rear + 42, "halide", null],
      [rear, "halide", null],
    ]);
    const train = hall.api.snapshot().train;
    expect(train).toHaveLength(4);
    // Seated at the rear core's own slot, not the slot 14 ahead of it.
    expect(train[2].charge).toBe("cobalt");
    expect(train[2].s).toBeCloseTo(topLegS(402), 3);
  });

  it("breaks a tie toward the core with the larger arc position", () => {
    const hall = ready();
    // The shot arrives on the perpendicular bisector of a pair 42 apart, so the two
    // center distances are equal and the core with the larger arc position takes it.
    const catchup = 180 / 60;
    const rear = topLegS(399) - catchup;
    seatShot(hall, [
      [4900, "olivine", null],
      [rear + 42, "halide", null],
      [rear, "halide", null],
    ]);
    const train = hall.api.snapshot().train;
    expect(train).toHaveLength(4);
    expect(train[2].charge).toBe("cobalt");
    // The slot behind the forward core, which is 14 ahead of the rear core.
    expect(train[2].s).toBeCloseTo(topLegS(441) - SPACING, 3);
  });

  it("shifts the train back to make room, and never moves the head", () => {
    const hall = ready();
    const head = topLegS(420 + 56);
    const posed: [number, "halide" | "garnet", null][] = [
      [head, "halide", null],
      [head - 28, "halide", null],
      [head - 56, "halide", null],
      [head - 84, "garnet", null],
      [head - 112, "garnet", null],
    ];
    seatShot(hall, posed);
    const train = hall.api.snapshot().train;
    expect(train).toHaveLength(6);
    // The head kept its arc position but for the one tick of feed the strike took.
    expect(train[0].s).toBeCloseTo(head + 22 / 60, 1);
    expect(last(train).s).toBeCloseTo(head - 112 + 22 / 60 - SPACING, 1);
  });
});
