import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CORE_R,
  DEG,
  FIELD_H,
  FIELD_W,
  MU,
  SHIP_R,
  SOFTEN,
  STAR_X,
  STAR_Y,
  TICK_DT,
} from "./constants";
import { gravityAt } from "./gravity";
import { createHarness, startPlaying, type Harness } from "./harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  startPlaying(h.debug);
});

afterEach(() => {
  h.dispose();
});

describe("the pull law", () => {
  it("follows the inverse square outside the softening radius", () => {
    for (const d of [200, 150, 120]) {
      const { ax, ay } = gravityAt(STAR_X - d, STAR_Y);
      expect(Math.hypot(ax, ay)).toBeCloseTo(MU / (d * d), 6);
      expect(ax).toBeGreaterThan(0);
      expect(ay).toBeCloseTo(0, 9);
    }
  });

  it("is capped inside the softening radius", () => {
    const { ax, ay } = gravityAt(STAR_X - 60, STAR_Y);
    expect(Math.hypot(ax, ay)).toBeCloseTo(MU / (SOFTEN * SOFTEN), 6);
  });

  it("uses the direct vector rather than a wrapped one", () => {
    // Forty units inside the top-left corner: the star is most of a field away
    // by the direct vector, and its wrapped image is much nearer.
    const { ax, ay } = gravityAt(40, 40);
    const direct = Math.hypot(STAR_X - 40, STAR_Y - 40);
    expect(Math.hypot(ax, ay)).toBeCloseTo(MU / (direct * direct), 6);
    expect(ax).toBeGreaterThan(0);
    expect(ay).toBeGreaterThan(0);
  });
});

describe("which bodies the well acts on", () => {
  it("bends a bullet toward the star", async () => {
    // Fired across the field on a line passing 150 units above the star.
    h.debug.addBullet(60, STAR_Y - 150, 600, 0);
    await h.seconds(1.4);
    const bullets = h.debug.snapshot().bullets;
    expect(bullets.length).toBe(1);
    expect(bullets[0].y).toBeGreaterThan(STAR_Y - 150 + 40);
  });

  it("bends a saucer bullet by the same law", async () => {
    h.debug.addEnemyBullet(60, STAR_Y - 150, 600, 0);
    await h.seconds(1.3);
    const shots = h.debug.snapshot().enemyBullets;
    expect(shots.length).toBe(1);
    expect(shots[0].y).toBeGreaterThan(STAR_Y - 150 + 30);
  });

  it("turns a rock's course toward the star", async () => {
    h.debug.addRock("small", 200, STAR_Y - 160);
    const id = h.debug.snapshot().rocks[0].id;
    h.debug.setRockVelocity(id, 200, 0);
    await h.seconds(1);
    const rock = h.debug.snapshot().rocks[0];
    expect(rock.vy).toBeGreaterThan(10);
  });

  it("gives a body at rest exactly one tick of the law", async () => {
    h.debug.addBullet(STAR_X - 200, STAR_Y, 0, 0);
    await h.advance(1);
    const bullet = h.debug.snapshot().bullets[0];
    expect(bullet.vx).toBeCloseTo((MU / (200 * 200)) * TICK_DT, 6);
    expect(bullet.vy).toBeCloseTo(0, 9);
  });

  it("points the pull at the star's centre from every bearing", async () => {
    for (const bearing of [0, 90, 200, 315]) {
      startPlaying(h.debug);
      const x = STAR_X + Math.cos(bearing * DEG) * 250;
      const y = STAR_Y + Math.sin(bearing * DEG) * 250;
      h.debug.addBullet(x, y, 0, 0);
      await h.advance(1);
      const bullet = h.debug.snapshot().bullets[0];
      const gained = Math.atan2(bullet.vy, bullet.vx);
      const toStar = Math.atan2(STAR_Y - y, STAR_X - x);
      expect(Math.abs(gained - toStar) / DEG).toBeLessThan(1);
    }
  });

  it("never pulls the saucer", async () => {
    h.debug.addSaucer(STAR_X + 120, STAR_Y - 200);
    h.debug.setSaucerMind(false);
    h.debug.setSaucerVelocity(0, 0);
    await h.seconds(2);
    const saucer = h.debug.snapshot().saucer;
    expect(saucer).not.toBeNull();
    expect(saucer?.vx).toBe(0);
    expect(saucer?.vy).toBe(0);
  });

  it("never pulls a torpedo, which flies true through the well", async () => {
    h.debug.addTorpedo(220, STAR_Y - 120, 0);
    const id = h.debug.snapshot().torpedoes[0].id;
    h.debug.setTorpedoHoming(id, false);
    await h.advance(240);
    const torpedo = h.debug.snapshot().torpedoes[0];
    expect(torpedo.heading).toBeCloseTo(0, 6);
    expect(Math.abs(torpedo.y - (STAR_Y - 120))).toBeLessThan(1);
  });
});

describe("the star's core", () => {
  it("absorbs a bullet, scoring nothing", async () => {
    h.debug.addBullet(STAR_X - 200, STAR_Y, 600, 0);
    await h.seconds(0.5);
    const snapshot = h.debug.snapshot();
    expect(snapshot.bullets.length).toBe(0);
    expect(snapshot.score).toBe(0);
  });

  it("absorbs a saucer bullet", async () => {
    h.debug.addEnemyBullet(STAR_X - 200, STAR_Y, 600, 0);
    await h.seconds(0.5);
    expect(h.debug.snapshot().enemyBullets.length).toBe(0);
  });

  it("absorbs a torpedo, scoring nothing", async () => {
    h.debug.addTorpedo(STAR_X - 200, STAR_Y, 0);
    const id = h.debug.snapshot().torpedoes[0].id;
    h.debug.setTorpedoHoming(id, false);
    await h.seconds(0.6);
    const snapshot = h.debug.snapshot();
    expect(snapshot.torpedoes.length).toBe(0);
    expect(snapshot.score).toBe(0);
  });

  it("recycles a rock it takes, keeping the count and the size", async () => {
    h.debug.addRock("medium", STAR_X - 200, STAR_Y);
    const id = h.debug.snapshot().rocks[0].id;
    h.debug.setRockVelocity(id, 400, 0);
    await h.seconds(0.5);
    const snapshot = h.debug.snapshot();
    expect(snapshot.rocks.length).toBe(1);
    expect(snapshot.rocks[0].size).toBe("medium");
    expect(snapshot.score).toBe(0);
    const distance = Math.hypot(
      snapshot.rocks[0].x - STAR_X,
      snapshot.rocks[0].y - STAR_Y,
    );
    expect(distance).toBeGreaterThan(200);
    // It came back at a fresh drift speed rather than the 400 it was slung at.
    const speed = Math.hypot(snapshot.rocks[0].vx, snapshot.rocks[0].vy);
    expect(speed).toBeGreaterThan(80);
    expect(speed).toBeLessThan(160);
  });

  it("slides the ship along its surface without costing a life", async () => {
    h.debug.setShipCollision(true);
    h.debug.setShipPosition(STAR_X - 200, STAR_Y - 12);
    h.debug.setShipVelocity(400, 0);
    h.debug.setShipAngle(0);
    await h.seconds(0.6);

    const { ship, lives, screen } = h.debug.snapshot();
    const distance = Math.hypot(ship.x - STAR_X, ship.y - STAR_Y);
    expect(distance).toBeGreaterThanOrEqual(CORE_R + SHIP_R - 1);
    expect(lives).toBe(3);
    expect(screen).toBe("playing");
    expect(ship.angle).toBeCloseTo(0, 9);
  });

  it("takes the ship's inward speed and keeps its tangential speed", async () => {
    h.debug.setShipCollision(true);
    h.debug.setShipPosition(STAR_X - 60, STAR_Y - 20);
    h.debug.setShipVelocity(300, 0);
    await h.advance(30);

    const { ship } = h.debug.snapshot();
    const nx = (ship.x - STAR_X) / Math.hypot(ship.x - STAR_X, ship.y - STAR_Y);
    const ny = (ship.y - STAR_Y) / Math.hypot(ship.x - STAR_X, ship.y - STAR_Y);
    const inward = ship.vx * nx + ship.vy * ny;
    expect(inward).toBeGreaterThan(-5);
    expect(Math.hypot(ship.vx, ship.vy)).toBeGreaterThan(100);
  });

  it("holds the ship exactly at the surface once it is resting on it", async () => {
    h.debug.setShipPosition(STAR_X, STAR_Y - 20);
    h.debug.setShipVelocity(0, 0);
    await h.advance(2);
    const { ship } = h.debug.snapshot();
    expect(Math.hypot(ship.x - STAR_X, ship.y - STAR_Y)).toBeCloseTo(
      CORE_R + SHIP_R,
      6,
    );
  });

  it("catches a body crossing the seam", async () => {
    // A bullet just inside the left edge travelling left, and a rock just
    // inside the right edge on the same row.
    h.debug.addRock("small", FIELD_W - 20, 120);
    h.debug.addBullet(14, 120, -600, 0);
    await h.seconds(0.1);
    expect(h.debug.snapshot().rocks.length).toBe(0);
    expect(h.debug.snapshot().bullets.length).toBe(0);
  });

  it("wraps a rock at every edge", async () => {
    const cases: [number, number, number, number][] = [
      [FIELD_W - 6, 120, 400, 0],
      [6, 120, -400, 0],
      [200, FIELD_H - 6, 0, 400],
      [200, 6, 0, -400],
    ];
    for (const [x, y, vx, vy] of cases) {
      startPlaying(h.debug);
      h.debug.addRock("small", x, y);
      const id = h.debug.snapshot().rocks[0].id;
      h.debug.setRockVelocity(id, vx, vy);
      await h.advance(4);
      const rock = h.debug.snapshot().rocks[0];
      if (vx > 0) expect(rock.x).toBeLessThan(20);
      if (vx < 0) expect(rock.x).toBeGreaterThan(FIELD_W - 20);
      if (vy > 0) expect(rock.y).toBeLessThan(20);
      if (vy < 0) expect(rock.y).toBeGreaterThan(FIELD_H - 20);
    }
  });
});
