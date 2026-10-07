import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEG,
  FACE_UP,
  FIELD_H,
  FIELD_W,
  SHIP_DRAG_HALFLIFE,
  SHIP_MAX,
  SHIP_THRUST,
  SHIP_TURN,
  STAR_X,
  STAR_Y,
} from "./constants";
import { normalizeAngle } from "./geometry";
import { createHarness, startPlaying, type Harness } from "./harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  startPlaying(h.debug);
});

afterEach(() => {
  h.dispose();
});

describe("inertial flight", () => {
  it("accelerates along the facing while thrust is held", async () => {
    h.debug.setShipAngle(0);
    h.down("ArrowUp");
    await h.seconds(1);
    h.up("ArrowUp");

    const { ship } = h.debug.snapshot();
    // A second of thrust less what the drag half-life bled off it.
    const drag = Math.pow(0.5, 1 / SHIP_DRAG_HALFLIFE);
    const expected = ((SHIP_THRUST * (1 - drag)) / -Math.log(drag)) * 1;
    expect(ship.speed).toBeGreaterThan(SHIP_THRUST * 0.75);
    expect(ship.speed).toBeLessThan(SHIP_THRUST);
    expect(Math.abs(ship.speed - expected)).toBeLessThan(SHIP_THRUST * 0.05);
    expect(Math.abs(ship.vy)).toBeLessThan(0.01);
    expect(ship.vx).toBeGreaterThan(0);
  });

  it("thrusts along whatever the facing is", async () => {
    for (const facing of [0, 90, 180, -90]) {
      startPlaying(h.debug);
      h.debug.setShipAngle(facing * DEG);
      h.down("KeyW");
      await h.seconds(0.5);
      h.up("KeyW");
      const { ship } = h.debug.snapshot();
      const bearing = Math.atan2(ship.vy, ship.vx);
      expect(
        Math.abs(normalizeAngle(bearing - facing * DEG)) / DEG,
      ).toBeLessThan(1);
      await h.advance(1);
    }
  });

  it("halves an un-thrusting ship's speed every three seconds", async () => {
    h.debug.setShipVelocity(400, 0);
    await h.seconds(SHIP_DRAG_HALFLIFE);
    expect(h.debug.snapshot().ship.speed).toBeCloseTo(200, 0);
  });

  it("caps the speed however long thrust is held", async () => {
    h.debug.setShipAngle(0);
    h.debug.setShipVelocity(SHIP_MAX, 0);
    h.down("ArrowUp");
    for (let step = 0; step < 240; step += 1) {
      await h.advance(1);
      expect(h.debug.snapshot().ship.speed).toBeLessThanOrEqual(SHIP_MAX + 1);
    }
    h.up("ArrowUp");
  });

  it("turns counter-clockwise on the left key at the stated rate", async () => {
    h.debug.setShipAngle(0);
    h.down("ArrowLeft");
    await h.seconds(1);
    h.up("ArrowLeft");
    expect(h.debug.snapshot().ship.angle).toBeCloseTo(-SHIP_TURN, 1);
  });

  it("turns clockwise on the right key at the stated rate", async () => {
    h.debug.setShipAngle(0);
    h.down("KeyD");
    await h.seconds(1);
    h.up("KeyD");
    expect(h.debug.snapshot().ship.angle).toBeCloseTo(SHIP_TURN, 1);
  });

  it("changes the facing alone when it turns", async () => {
    h.debug.setShipVelocity(200, 0);
    h.down("ArrowLeft");
    await h.seconds(1);
    h.up("ArrowLeft");
    // Only the drag accounts for the change: no rotation leaked into it.
    const expected = 200 * Math.pow(0.5, 1 / SHIP_DRAG_HALFLIFE);
    const { ship } = h.debug.snapshot();
    expect(ship.vx).toBeCloseTo(expected, 1);
    expect(ship.vy).toBeCloseTo(0, 6);
  });

  it("is never pulled by the well", async () => {
    h.debug.setShipPosition(STAR_X + 120, STAR_Y);
    h.debug.setShipVelocity(0, 0);
    await h.seconds(2);
    const { ship } = h.debug.snapshot();
    expect(ship.x).toBeCloseTo(STAR_X + 120, 6);
    expect(ship.y).toBeCloseTo(STAR_Y, 6);
    expect(ship.speed).toBeCloseTo(0, 6);
  });

  it("wraps at every edge, carrying its velocity across", async () => {
    const cases: [number, number, number, number, number, number][] = [
      [FIELD_W - 5, 360, 400, 0, 5, 360],
      [5, 360, -400, 0, FIELD_W - 5, 360],
      [640, FIELD_H - 5, 0, 400, 640, 5],
      [640, 5, 0, -400, 640, FIELD_H - 5],
    ];
    for (const [x, y, vx, vy, endX, endY] of cases) {
      startPlaying(h.debug);
      h.debug.setShipPosition(x, y);
      h.debug.setShipVelocity(vx, vy);
      await h.advance(4);
      const { ship } = h.debug.snapshot();
      // Four ticks at 400 units/s is 13.3 units of travel past the seam.
      expect(Math.abs(ship.x - endX)).toBeLessThan(20);
      expect(Math.abs(ship.y - endY)).toBeLessThan(20);
      expect(Math.sign(ship.vx)).toBe(Math.sign(vx));
      expect(Math.sign(ship.vy)).toBe(Math.sign(vy));
    }
  });

  it("begins a life at the safe point facing up", async () => {
    h.debug.reset();
    await h.advance(1);
    const { ship } = h.debug.snapshot();
    expect(ship.x).toBe(640);
    expect(ship.y).toBe(560);
    expect(ship.angle).toBeCloseTo(FACE_UP, 9);
    expect(ship.speed).toBe(0);
  });
});
