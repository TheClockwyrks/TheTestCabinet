import { afterEach, describe, expect, it } from "vitest";
import {
  BULLET_LIFE,
  FIRE_INTERVAL_TICKS,
  MAX_BULLETS,
  MUZZLE_SPEED,
  SCORE_SMALL,
  SHIP_DRAG_HALFLIFE,
  SHIP_R,
  STAR_X,
  STAR_Y,
} from "./constants";
import { createHarness, startPlaying, ticksFor, type Harness } from "./harness";

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

describe("the gun", () => {
  it("takes a shot from the nose, ahead of the ship along its facing", async () => {
    const h = await playing();
    h.debug.setShipAngle(0);
    await h.tap("Space");

    const seen = h.debug.snapshot();
    expect(seen.bullets).toHaveLength(1);
    const bullet = seen.bullets[0];
    const dx = bullet.x - seen.ship.x;
    const dy = bullet.y - seen.ship.y;
    expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(SHIP_R);
    expect(dx).toBeGreaterThan(0);
    // Ahead of the ship along its facing, to within the well's own nudge.
    expect(Math.abs(Math.atan2(dy, dx))).toBeLessThan(Math.PI / 180);
  });

  it("leaves at the muzzle speed along the facing", async () => {
    const h = await playing();
    h.debug.setShipAngle(0);
    h.debug.setShipVelocity(0, 0);
    h.down("Space");
    await h.advance(1);

    const bullet = h.debug.snapshot().bullets[0];
    expect(Math.hypot(bullet.vx, bullet.vy)).toBeCloseTo(MUZZLE_SPEED, 6);
    expect(bullet.vy).toBeCloseTo(0, 6);
  });

  it("carries the ship's own drift", async () => {
    const h = await playing();
    h.debug.setShipPosition(200, 200);
    h.debug.setShipAngle(0);
    h.debug.setShipVelocity(0, 300);
    h.down("Space");
    await h.advance(1);

    // The ship's own velocity as it stands on the tick the round leaves, which
    // the tick's drag has already touched.
    const drift = 300 * Math.pow(0.5, 1 / 120 / SHIP_DRAG_HALFLIFE);
    const bullet = h.debug.snapshot().bullets[0];
    expect(bullet.vx).toBeCloseTo(MUZZLE_SPEED, 3);
    expect(bullet.vy).toBeCloseTo(drift, 3);
  });

  it("expires after its lifetime", async () => {
    const h = await playing();
    h.debug.addBullet(120, 120, 0, 0);
    await h.seconds(BULLET_LIFE - 0.1);
    expect(h.debug.snapshot().bullets).toHaveLength(1);
    await h.seconds(0.2);
    expect(h.debug.snapshot().bullets).toHaveLength(0);
  });

  it("holds at most four of the ship's rounds in flight", async () => {
    const h = await playing();
    h.debug.setShipPosition(200, 120);
    h.debug.setShipAngle(0);
    h.down("Space");
    await h.seconds(1.2);
    expect(h.debug.snapshot().bullets.length).toBeLessThanOrEqual(MAX_BULLETS);

    h.debug.clearBullets();
    for (let index = 0; index < MAX_BULLETS; index += 1) {
      h.debug.addBullet(600, 60 + index, 0, 0);
    }
    h.debug.setFireCooldown(0);
    await h.advance(1);
    expect(h.debug.snapshot().bullets).toHaveLength(MAX_BULLETS);
  });

  it("gates its shots to one every twenty-two ticks", async () => {
    const h = await playing();
    h.debug.setShipPosition(200, 120);
    h.debug.setShipAngle(0);
    h.down("Space");

    const shots: number[] = [];
    for (let tick = 0; tick < 200; tick += 1) {
      await h.advance(1);
      if (h.debug.snapshot().bullets.length > 0) {
        shots.push(tick);
        // Cleared so the four-in-flight cap never decides the interval.
        h.debug.clearBullets();
      }
    }
    expect(shots.length).toBeGreaterThan(4);
    for (let index = 1; index < shots.length; index += 1) {
      expect(shots[index] - shots[index - 1]).toBe(FIRE_INTERVAL_TICKS);
    }
  });

  it("refuses a shot inside the gate and allows one after it", async () => {
    const h = await playing();
    h.debug.setShipPosition(200, 120);
    h.debug.setFireCooldown(10);
    h.down("Space");
    await h.advance(9);
    expect(h.debug.snapshot().bullets).toHaveLength(0);
    await h.advance(1);
    expect(h.debug.snapshot().bullets).toHaveLength(1);
  });
});

describe("a round in flight", () => {
  it("is bent toward the star", async () => {
    const h = await playing();
    // Fired straight across the field on a line passing 150 units above it.
    h.debug.addBullet(120, STAR_Y - 150, MUZZLE_SPEED, 0);
    await h.seconds(BULLET_LIFE - 0.1);
    const bullet = h.debug.snapshot().bullets[0];
    // Forty units clear of the straight line the same shot would have held.
    expect(bullet.y).toBeGreaterThan(STAR_Y - 150 + 40);
    expect(bullet.vy).toBeGreaterThan(0);
  });

  it("is absorbed by the core, scoring nothing", async () => {
    const h = await playing();
    h.debug.addBullet(STAR_X - 200, STAR_Y, 900, 0);
    await h.seconds(0.4);
    const seen = h.debug.snapshot();
    expect(seen.bullets).toHaveLength(0);
    expect(seen.score).toBe(0);
  });

  it("wraps at every edge", async () => {
    const h = await playing();
    const runs: [number, number, number, number][] = [
      [8, 120, -600, 0],
      [1272, 120, 600, 0],
      [200, 8, 0, -600],
      [200, 712, 0, 600],
    ];
    for (const [x, y, vx, vy] of runs) {
      startPlaying(h.debug);
      h.debug.addBullet(x, y, vx, vy);
      await h.advance(4);
      const bullet = h.debug.snapshot().bullets[0];
      expect(bullet.x).toBeGreaterThanOrEqual(0);
      expect(bullet.x).toBeLessThan(1280);
      expect(bullet.y).toBeGreaterThanOrEqual(0);
      expect(bullet.y).toBeLessThan(720);
    }
  });

  it("does not pass through a rock it is closing on fast", async () => {
    const h = await playing();
    h.debug.addRock("small", 300, 150);
    h.debug.addBullet(274, 150, 1200, 0);
    await h.advance(1);

    let seen = h.debug.snapshot();
    expect(seen.rocks).toHaveLength(0);
    expect(seen.bullets).toHaveLength(0);
    expect(seen.score).toBe(SCORE_SMALL);

    // The same shot, offset further than the combined radius, misses.
    startPlaying(h.debug);
    h.debug.addRock("small", 300, 150);
    h.debug.addBullet(274, 170, 1200, 0);
    await h.advance(1);
    seen = h.debug.snapshot();
    expect(seen.rocks).toHaveLength(1);
    expect(seen.bullets).toHaveLength(1);
    expect(seen.score).toBe(0);
  });

  it("collides across a seam", async () => {
    const h = await playing();
    h.debug.addRock("small", 1272, 300);
    h.debug.addBullet(8, 300, -600, 0);
    await h.seconds(0.1);
    expect(h.debug.snapshot().rocks).toHaveLength(0);
  });

  it("holds the same reading however the ticks are grouped", async () => {
    const reading = async (chunk: number): Promise<string> => {
      const h = await createHarness();
      h.debug.reset();
      startPlaying(h.debug);
      h.debug.addBullet(120, STAR_Y - 150, 700, 0);
      for (let done = 0; done < ticksFor(0.5); done += chunk) {
        await h.advance(chunk);
      }
      const bullet = h.debug.snapshot().bullets[0];
      const seen = `${bullet.x.toFixed(6)},${bullet.y.toFixed(6)}`;
      h.dispose();
      return seen;
    };
    expect(await reading(1)).toBe(await reading(6));
  });
});
