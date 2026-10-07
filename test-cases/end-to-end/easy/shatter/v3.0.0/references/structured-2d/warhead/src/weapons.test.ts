import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BULLET_R,
  DEG,
  FIELD_W,
  FIRE_INTERVAL_TICKS,
  MAX_BULLETS,
  MUZZLE_SPEED,
  ROCK_RADIUS,
  SHIP_MAX,
  SHIP_R,
  STAR_Y,
  TORPEDO_RECHARGE,
  TORPEDO_SPEED,
} from "./constants";
import { normalizeAngle } from "./geometry";
import { createHarness, poseRock, startPlaying, type Harness } from "./harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  startPlaying(h.debug);
});

afterEach(() => {
  h.dispose();
});

// `reconcile` brings every reported reading into agreement with the field without
// advancing anything. This build works its three derived readings — the ship's
// `speed`, each rock's `radius`, and `torpedoReady` — out at the READ, so the call
// has nothing to rewrite; what these two cases pin is that it still ANSWERS for a
// posed field and that it costs no simulation time, which is the whole difference
// between it and stepping a tick.
describe("reconcile", () => {
  it("re-derives a reading from a posed velocity and charge", () => {
    h.debug.setShipVelocity(30, 40);
    h.debug.reconcile();
    expect(h.debug.snapshot().ship.speed).toBeCloseTo(50, 10);

    h.debug.setTorpedoCharge(1);
    h.debug.reconcile();
    expect(h.debug.snapshot().torpedoReady).toBe(true);

    h.debug.setTorpedoCharge(0.5);
    h.debug.reconcile();
    expect(h.debug.snapshot().torpedoReady).toBe(false);

    poseRock(h.debug, "medium", 300, 300);
    h.debug.reconcile();
    expect(h.debug.snapshot().rocks[0].radius).toBe(ROCK_RADIUS.medium);
  });

  it("advances nothing, and twice matches once", () => {
    h.debug.setShipPosition(400, 300);
    h.debug.setShipVelocity(120, -90);
    h.debug.setShipInvuln(2);
    h.debug.setFireCooldown(7);
    h.debug.setWaveBanner(1.5);
    poseRock(h.debug, "large", 700, 200);
    h.debug.addBullet(100, 100, 50, 0);
    h.debug.addTorpedo(300, 400, 0);
    h.debug.addSaucer(200, 500);

    const before = JSON.stringify(h.debug.snapshot());
    h.debug.reconcile();
    const once = JSON.stringify(h.debug.snapshot());
    h.debug.reconcile();
    const twice = JSON.stringify(h.debug.snapshot());

    // The clock, the positions, the velocities and every timer are untouched, so
    // the whole snapshot is byte-identical rather than merely close.
    expect(once).toBe(before);
    expect(twice).toBe(once);
  });
});

describe("the gun", () => {
  it("puts a round at the nose at the muzzle speed", async () => {
    h.debug.setShipPosition(400, 400);
    h.debug.setShipAngle(0);
    h.down("Space");
    await h.advance(1);
    h.up("Space");

    const bullets = h.debug.snapshot().bullets;
    expect(bullets.length).toBe(1);
    const [bullet] = bullets;
    const ahead = bullet.x - 400;
    expect(ahead).toBeGreaterThan(0);
    expect(Math.hypot(ahead, bullet.y - 400)).toBeLessThanOrEqual(SHIP_R);
    expect(Math.hypot(bullet.vx, bullet.vy)).toBeCloseTo(MUZZLE_SPEED, 6);

    // And it is still inside the ship's own radius a tick later.
    await h.advance(1);
    const [travelled] = h.debug.snapshot().bullets;
    expect(
      Math.hypot(travelled.x - 400, travelled.y - 400),
    ).toBeLessThanOrEqual(SHIP_R);
  });

  it("carries the ship's drift", async () => {
    h.debug.setShipPosition(400, 400);
    h.debug.setShipAngle(0);
    h.debug.setShipVelocity(0, 300);
    h.down("Space");
    await h.advance(1);
    h.up("Space");

    const [bullet] = h.debug.snapshot().bullets;
    // The drag has taken a little off the drift by the tick it is fired on.
    expect(bullet.vx).toBeCloseTo(MUZZLE_SPEED, 6);
    expect(bullet.vy).toBeGreaterThan(280);
    expect(bullet.vy).toBeLessThan(305);
  });

  it("expires after its lifetime", async () => {
    h.debug.addBullet(200, 80, 0, 0);
    await h.seconds(1.4);
    expect(h.debug.snapshot().bullets.length).toBe(1);
    await h.seconds(0.2);
    expect(h.debug.snapshot().bullets.length).toBe(0);
  });

  it("holds four rounds in flight at once and no more", async () => {
    h.debug.setShipPosition(400, 400);
    h.debug.setShipAngle(0);
    h.down("Space");
    await h.advance(FIRE_INTERVAL_TICKS * 6);
    h.up("Space");
    expect(h.debug.snapshot().bullets.length).toBe(MAX_BULLETS);
  });

  it("gates a held key to one shot every 22 ticks", async () => {
    h.debug.setShipPosition(400, 400);
    h.debug.setShipAngle(0);
    h.down("Space");

    let shots = 0;
    for (let tick = 0; tick < 120; tick += 1) {
      await h.advance(1);
      shots += h.debug.snapshot().bullets.length;
      // Clear the roster so the on-screen cap never stands in for the gate.
      h.debug.clearBullets();
    }
    h.up("Space");
    expect(Math.abs(shots - 120 / FIRE_INTERVAL_TICKS)).toBeLessThanOrEqual(1);
  });

  it("refuses a shot inside the gate", async () => {
    h.debug.setFireCooldown(10);
    h.down("Space");
    await h.advance(1);
    expect(h.debug.snapshot().bullets.length).toBe(0);
    await h.advance(10);
    h.up("Space");
    expect(h.debug.snapshot().bullets.length).toBe(1);
  });

  it("does not pass through a rock at the fastest a round can travel", async () => {
    const speed = MUZZLE_SPEED + SHIP_MAX;
    poseRock(h.debug, "small", 700, 300);
    h.debug.addBullet(700 - speed / 120, 300, speed, 0);
    await h.advance(1);
    expect(h.debug.snapshot().rocks.length).toBe(0);
  });

  it("misses the same rock offset past the combined radius", async () => {
    const speed = MUZZLE_SPEED + SHIP_MAX;
    poseRock(h.debug, "small", 700, 300);
    const clear = BULLET_R + ROCK_RADIUS.small + 4;
    h.debug.addBullet(700 - speed / 120, 300 + clear, speed, 0);
    await h.advance(1);
    expect(h.debug.snapshot().rocks.length).toBe(1);
  });
});

describe("the torpedo", () => {
  it("launches one on the torpedo key, from the nose along the facing", async () => {
    h.debug.setShipPosition(400, 400);
    h.debug.setShipAngle(0);
    h.down("KeyF");
    await h.advance(1);
    h.up("KeyF");

    const torpedoes = h.debug.snapshot().torpedoes;
    expect(torpedoes.length).toBe(1);
    const [torpedo] = torpedoes;
    expect(torpedo.heading).toBeCloseTo(0, 6);
    expect(Math.hypot(torpedo.x - 400, torpedo.y - 400)).toBeLessThanOrEqual(
      SHIP_R,
    );
    expect(Math.hypot(torpedo.vx, torpedo.vy)).toBeCloseTo(TORPEDO_SPEED, 6);
  });

  it("leaves along whatever the facing is", async () => {
    for (const facing of [0, 90, 180, -90]) {
      startPlaying(h.debug);
      h.debug.setShipAngle(facing * DEG);
      await h.tap("KeyF");
      const [torpedo] = h.debug.snapshot().torpedoes;
      expect(
        Math.abs(normalizeAngle(torpedo.heading - facing * DEG)) / DEG,
      ).toBeLessThan(1);
      h.debug.clearTorpedoes();
    }
  });

  it("carries none of the ship's drift", async () => {
    h.debug.setShipAngle(0);
    h.debug.setShipVelocity(0, 300);
    await h.tap("KeyF");
    const [torpedo] = h.debug.snapshot().torpedoes;
    expect(torpedo.vx).toBeCloseTo(TORPEDO_SPEED, 6);
    expect(torpedo.vy).toBeCloseTo(0, 6);
  });

  it("spends the charge and refills it linearly over ten seconds", async () => {
    await h.tap("KeyF");
    h.debug.clearTorpedoes();
    expect(h.debug.snapshot().torpedoCharge).toBeLessThan(0.02);
    expect(h.debug.snapshot().torpedoReady).toBe(false);

    await h.seconds(2.5);
    expect(h.debug.snapshot().torpedoCharge).toBeCloseTo(0.25, 2);
    await h.seconds(2.5);
    expect(h.debug.snapshot().torpedoCharge).toBeCloseTo(0.5, 2);
    await h.seconds(TORPEDO_RECHARGE / 2);
    expect(h.debug.snapshot().torpedoCharge).toBe(1);
    expect(h.debug.snapshot().torpedoReady).toBe(true);
  });

  it("launches nothing while the charge is short", async () => {
    h.debug.setTorpedoCharge(0.5);
    await h.tap("KeyF");
    expect(h.debug.snapshot().torpedoes.length).toBe(0);
  });

  it("launches nothing while one is already up", async () => {
    h.debug.addTorpedo(300, 300, 0);
    h.debug.setTorpedoCharge(1);
    await h.tap("KeyF");
    expect(h.debug.snapshot().torpedoes.length).toBe(1);
  });

  it("expires after its lifetime", async () => {
    h.debug.addTorpedo(200, 60, -Math.PI / 2);
    const id = h.debug.snapshot().torpedoes[0].id;
    h.debug.setTorpedoHoming(id, false);
    await h.seconds(3.4);
    expect(h.debug.snapshot().torpedoes.length).toBe(1);
    await h.seconds(0.2);
    expect(h.debug.snapshot().torpedoes.length).toBe(0);
  });

  it("wraps at the field edges carrying its speed", async () => {
    h.debug.addTorpedo(FIELD_W - 10, 200, 0);
    const id = h.debug.snapshot().torpedoes[0].id;
    h.debug.setTorpedoHoming(id, false);
    await h.advance(6);
    const [torpedo] = h.debug.snapshot().torpedoes;
    expect(torpedo.x).toBeLessThan(30);
    expect(Math.hypot(torpedo.vx, torpedo.vy)).toBeCloseTo(TORPEDO_SPEED, 6);
  });
});

describe("the torpedo's guidance", () => {
  it("turns onto a rock inside its forward cone", async () => {
    poseRock(h.debug, "small", 700, STAR_Y - 300 + 40);
    h.debug.addTorpedo(300, STAR_Y - 300, 0);
    await h.seconds(0.2);
    const [torpedo] = h.debug.snapshot().torpedoes;
    expect(torpedo.heading).toBeGreaterThan(2 * DEG);
  });

  it("acquires a rock 14 degrees off and not one 16 degrees off", async () => {
    for (const [off, acquired] of [
      [14, true],
      [16, false],
    ] as const) {
      startPlaying(h.debug);
      const reach = 500;
      poseRock(
        h.debug,
        "small",
        200 + Math.cos(off * DEG) * reach,
        200 + Math.sin(off * DEG) * reach,
      );
      h.debug.addTorpedo(200, 200, 0);
      await h.advance(2);
      const [torpedo] = h.debug.snapshot().torpedoes;
      if (acquired) expect(torpedo.heading).toBeGreaterThan(1 * DEG);
      else expect(torpedo.heading).toBeCloseTo(0, 9);
    }
  });

  it("never acquires a body behind it", async () => {
    // Behind it by the direct vector and by the wrap alike, for the whole run.
    poseRock(h.debug, "small", 400, 200);
    h.debug.addTorpedo(700, 200, 0);
    await h.seconds(0.5);
    const [torpedo] = h.debug.snapshot().torpedoes;
    expect(torpedo.heading).toBeCloseTo(0, 9);
    expect(h.debug.snapshot().rocks.length).toBe(1);
  });

  it("takes the nearer of two bodies in the cone", async () => {
    poseRock(h.debug, "small", 900, 220);
    poseRock(h.debug, "small", 500, 180);
    h.debug.addTorpedo(200, 200, 0);
    await h.advance(2);
    const [torpedo] = h.debug.snapshot().torpedoes;
    // The nearer rock is above the heading, the further one below it.
    expect(torpedo.heading).toBeLessThan(0);
  });

  it("turns at the stated rate and holds its speed while turning", async () => {
    poseRock(h.debug, "small", 600, 200 + 60);
    h.debug.addTorpedo(200, 200, 0);
    await h.advance(1);
    const before = h.debug.snapshot().torpedoes[0].heading;
    await h.advance(60);
    const after = h.debug.snapshot().torpedoes[0];
    expect(Math.abs(after.heading - before)).toBeGreaterThan(0);
    expect(Math.hypot(after.vx, after.vy)).toBeCloseTo(TORPEDO_SPEED, 4);
  });

  it("holds its heading with its guidance gated off", async () => {
    poseRock(h.debug, "small", 700, 240);
    h.debug.addTorpedo(200, 200, 0);
    const id = h.debug.snapshot().torpedoes[0].id;
    h.debug.setTorpedoHoming(id, false);
    await h.advance(4);
    expect(h.debug.snapshot().torpedoes[0].heading).toBeCloseTo(0, 9);
  });
});
