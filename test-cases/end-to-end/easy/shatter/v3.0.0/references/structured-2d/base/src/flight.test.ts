import { afterEach, describe, expect, it } from "vitest";
import {
  CORE_R,
  SHIP_DRAG_HALFLIFE,
  SHIP_MAX,
  SHIP_R,
  SHIP_TURN,
  STAR_X,
  STAR_Y,
} from "./constants";
import { createHarness, startPlaying, type Harness } from "./harness";

let harness: Harness | null = null;

async function playing(): Promise<Harness> {
  harness = await createHarness();
  startPlaying(harness.debug);
  return harness;
}

afterEach(() => {
  harness?.dispose();
  harness = null;
});

describe("inertial flight", () => {
  it("thrust accelerates the ship, less what the drag removes", async () => {
    const h = await playing();
    h.debug.setShipAngle(0);
    h.down("ArrowUp");
    await h.seconds(1);
    // dv/dt = a - v ln2 / halflife, so a second of burn from rest reaches
    // (a / lambda)(1 - e^-lambda) rather than a whole `a`.
    const lambda = Math.LN2 / SHIP_DRAG_HALFLIFE;
    const expected = (480 / lambda) * (1 - Math.exp(-lambda));
    expect(h.debug.snapshot().ship.speed).toBeCloseTo(expected, -1);
    expect(h.debug.snapshot().ship.speed / expected).toBeGreaterThan(0.95);
    expect(h.debug.snapshot().ship.speed / expected).toBeLessThan(1.05);
  });

  it("thrust acts along the facing", async () => {
    const h = await playing();
    for (const facing of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      startPlaying(h.debug);
      h.debug.setShipAngle(facing);
      h.down("ArrowUp");
      await h.seconds(0.5);
      h.up("ArrowUp");
      const ship = h.debug.snapshot().ship;
      const bearing = Math.atan2(ship.vy, ship.vx);
      expect(Math.abs(Math.atan2(Math.sin(bearing - facing), Math.cos(bearing - facing)))).toBeLessThan(
        (1 * Math.PI) / 180,
      );
    }
  });

  it("marks the ship as thrusting only while the key is down", async () => {
    const h = await playing();
    expect(h.debug.snapshot().ship.thrusting).toBe(false);
    h.down("ArrowUp");
    await h.advance(1);
    expect(h.debug.snapshot().ship.thrusting).toBe(true);
    h.up("ArrowUp");
    await h.advance(1);
    expect(h.debug.snapshot().ship.thrusting).toBe(false);
  });

  it("halves an un-thrusting ship's speed every three seconds", async () => {
    const h = await playing();
    h.debug.setShipVelocity(400, 0);
    await h.seconds(SHIP_DRAG_HALFLIFE);
    expect(h.debug.snapshot().ship.speed).toBeCloseTo(200, 0);
  });

  it("caps the ship's speed", async () => {
    const h = await playing();
    h.debug.setShipAngle(0);
    h.debug.setShipVelocity(SHIP_MAX, 0);
    h.down("ArrowUp");
    for (let tick = 0; tick < 240; tick += 1) {
      await h.advance(1);
      expect(h.debug.snapshot().ship.speed).toBeLessThanOrEqual(SHIP_MAX + 1);
    }
  });

  it("turns at the stated rate in both directions", async () => {
    const h = await playing();
    h.debug.setShipAngle(0);
    h.down("ArrowLeft");
    await h.seconds(1);
    h.up("ArrowLeft");
    await h.advance(1);
    expect(h.debug.snapshot().ship.angle).toBeCloseTo(-SHIP_TURN, 1);

    h.debug.setShipAngle(0);
    h.down("ArrowRight");
    await h.seconds(1);
    h.up("ArrowRight");
    await h.advance(1);
    expect(h.debug.snapshot().ship.angle).toBeCloseTo(SHIP_TURN, 1);
  });

  it("turning changes the facing alone", async () => {
    const h = await playing();
    // Clear of the star's column, so nothing but the drag touches the velocity.
    h.debug.setShipPosition(200, 560);
    h.debug.setShipAngle(0);
    h.debug.setShipVelocity(0, -240);
    h.down("ArrowLeft");
    await h.seconds(1);
    const ship = h.debug.snapshot().ship;
    // Only the drag has touched the velocity, and its bearing is unchanged.
    expect(ship.speed).toBeCloseTo(
      240 * Math.pow(0.5, 1 / SHIP_DRAG_HALFLIFE),
      0,
    );
    expect(ship.vx).toBeCloseTo(0, 6);
    expect(ship.vy).toBeLessThan(0);
  });

  it("wraps at every edge, carrying its velocity across", async () => {
    const h = await playing();
    const runs: [number, number, number, number][] = [
      [10, 360, -300, 0],
      [1270, 360, 300, 0],
      [640, 10, 0, -300],
      [640, 710, 0, 300],
    ];
    for (const [x, y, vx, vy] of runs) {
      startPlaying(h.debug);
      h.debug.setShipPosition(x, y);
      h.debug.setShipVelocity(vx, vy);
      await h.seconds(0.5);
      const ship = h.debug.snapshot().ship;
      expect(ship.x).toBeGreaterThanOrEqual(0);
      expect(ship.x).toBeLessThan(1280);
      expect(ship.y).toBeGreaterThanOrEqual(0);
      expect(ship.y).toBeLessThan(720);
      // The velocity crossed the seam unchanged but for the drag.
      expect(Math.sign(ship.vx) || 0).toBe(Math.sign(vx));
      expect(Math.sign(ship.vy) || 0).toBe(Math.sign(vy));
    }
  });
});

describe("the star's core", () => {
  it("puts the ship back on the surface and takes its inward speed", async () => {
    const h = await playing();
    h.debug.setShipPosition(STAR_X - 200, STAR_Y);
    h.debug.setShipVelocity(400, 0);
    await h.seconds(1);

    const ship = h.debug.snapshot().ship;
    const dx = ship.x - STAR_X;
    const dy = ship.y - STAR_Y;
    expect(Math.hypot(dx, dy)).toBeCloseTo(CORE_R + SHIP_R, 0);

    const nx = dx / Math.hypot(dx, dy);
    const ny = dy / Math.hypot(dx, dy);
    expect(Math.abs(ship.vx * nx + ship.vy * ny)).toBeLessThan(5);
  });

  it("keeps the motion along the surface", async () => {
    const h = await playing();
    // Aimed past the centre, so most of the arriving speed lies along the core.
    h.debug.setShipPosition(STAR_X - 200, STAR_Y - 40);
    h.debug.setShipVelocity(300, 0);

    let onTheSurface = false;
    for (let tick = 0; tick < 200 && !onTheSurface; tick += 1) {
      await h.advance(1);
      const ship = h.debug.snapshot().ship;
      const dx = ship.x - STAR_X;
      const dy = ship.y - STAR_Y;
      const d = Math.hypot(dx, dy);
      if (Math.abs(d - (CORE_R + SHIP_R)) > 0.001) continue;

      onTheSurface = true;
      const nx = dx / d;
      const ny = dy / d;
      // No motion into the core, and the motion along it is what arrived.
      expect(Math.abs(ship.vx * nx + ship.vy * ny)).toBeLessThan(5);
      expect(ship.speed).toBeGreaterThan(0.8 * 300 * Math.abs(ny));
    }
    expect(onTheSurface).toBe(true);
  });

  it("leaves the facing alone and costs no life", async () => {
    const h = await playing();
    h.debug.setShipCollision(true);
    h.debug.setShipAngle(0);
    h.debug.setShipPosition(STAR_X - 200, STAR_Y);
    h.debug.setShipVelocity(400, 0);
    await h.seconds(1);

    const seen = h.debug.snapshot();
    expect(seen.ship.angle).toBe(0);
    expect(seen.lives).toBe(3);
    expect(seen.screen).toBe("playing");
  });

  it("never pulls the ship", async () => {
    const h = await playing();
    h.debug.setShipPosition(STAR_X + 120, STAR_Y);
    h.debug.setShipVelocity(0, 0);
    await h.seconds(2);
    const ship = h.debug.snapshot().ship;
    expect(ship.x).toBeCloseTo(STAR_X + 120, 6);
    expect(ship.y).toBeCloseTo(STAR_Y, 6);
    expect(ship.speed).toBeCloseTo(0, 6);
  });
});
