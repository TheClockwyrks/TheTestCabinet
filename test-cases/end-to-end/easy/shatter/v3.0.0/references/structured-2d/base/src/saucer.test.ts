import { afterEach, describe, expect, it } from "vitest";
import {
  CORE_R,
  FIELD_H,
  SAUCER_AIM_ERROR,
  SAUCER_BULLET_LIFE,
  SAUCER_BULLET_SPEED,
  SAUCER_FIRE_INTERVAL,
  SAUCER_GAP_MAX,
  SAUCER_GAP_MIN,
  SAUCER_LIFETIME,
  SAUCER_R,
  SAUCER_SPEED,
  SAUCER_WEAVE_INTERVAL,
  SAUCER_WEAVE_SPEED,
  SCORE_SAUCER,
  STAR_X,
  STAR_Y,
} from "./constants";
import { deltaX, deltaY } from "./geometry";
import {
  createHarness,
  poseRock,
  startPlaying,
  ticksFor,
  type Harness,
} from "./harness";

/** Long enough for a test that steps a minute or more of game time. */
const LONG = 40_000;

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

/** A saucer standing still, deciding nothing: the gun read on its own. */
function poseGunner(h: Harness, x: number, y: number): void {
  h.debug.addSaucer(x, y);
  h.debug.setSaucerVelocity(0, 0);
  h.debug.setSaucerMind(false);
  h.debug.setSaucerTravel(false);
}

describe("the saucer's cadence", () => {
  it(
    "brings the first one in about eighteen seconds",
    async () => {
      const h = await playing();
      h.debug.setSaucerSpawning(true);
      await h.seconds(16);
      expect(h.debug.snapshot().saucer).toBeNull();
      await h.seconds(4);
      expect(h.debug.snapshot().saucer).not.toBeNull();
    },
    LONG,
  );

  it(
    "never starts a second visit over a live one",
    async () => {
      const h = await playing();
      h.debug.setSaucerSpawning(true);

      let previous: number | null = null;
      let gapSeen = true;
      for (let tick = 0; tick < ticksFor(70); tick += 1) {
        await h.advance(1);
        const saucer = h.debug.snapshot().saucer;
        if (saucer === null) {
          previous = null;
          gapSeen = true;
          continue;
        }
        if (previous !== null && saucer.id !== previous) {
          // One visit followed another with no tick reporting an empty slot.
          expect(gapSeen).toBe(true);
        }
        if (previous === null || saucer.id !== previous) gapSeen = false;
        previous = saucer.id;
      }
    },
    LONG,
  );

  it(
    "leaves after its lifetime and returns after a drawn gap",
    async () => {
      const h = await playing();
      h.debug.addSaucer(200, 200);
      h.debug.setSaucerMind(false);
      h.debug.setSaucerGun(false);
      await h.seconds(SAUCER_LIFETIME - 0.5);
      expect(h.debug.snapshot().saucer).not.toBeNull();
      await h.seconds(1);
      expect(h.debug.snapshot().saucer).toBeNull();

      h.debug.setSaucerSpawning(true);
      let gap = 0;
      for (let tick = 0; tick < ticksFor(SAUCER_GAP_MAX + 5); tick += 1) {
        await h.advance(1);
        gap += 1 / 120;
        if (h.debug.snapshot().saucer !== null) break;
      }
      expect(gap).toBeGreaterThanOrEqual(SAUCER_GAP_MIN - 0.5);
      expect(gap).toBeLessThanOrEqual(SAUCER_GAP_MAX + 0.5);
    },
    LONG,
  );

  it(
    "enters at an edge, on a row drawn across the field",
    async () => {
      const rows: number[] = [];
      for (let game = 0; game < 4; game += 1) {
        const h = await createHarness();
        h.debug.reset();
        startPlaying(h.debug);
        h.debug.setSaucerSpawning(true);
        for (let visit = 0; visit < 2; visit += 1) {
          for (let tick = 0; tick < ticksFor(60); tick += 1) {
            await h.advance(1);
            const saucer = h.debug.snapshot().saucer;
            if (saucer === null) continue;
            expect(Math.min(saucer.x, 1280 - saucer.x)).toBeLessThan(40);
            expect(saucer.y).toBeGreaterThanOrEqual(SAUCER_R - 1);
            expect(saucer.y).toBeLessThanOrEqual(FIELD_H - SAUCER_R + 1);
            rows.push(saucer.y);
            h.debug.removeSaucer();
            break;
          }
        }
        h.dispose();
      }
      expect(rows.length).toBeGreaterThanOrEqual(8);
      const span = Math.max(...rows) - Math.min(...rows);
      expect(span).toBeGreaterThan((FIELD_H - 2 * SAUCER_R) / 2);
    },
    LONG,
  );
});

describe("how the saucer travels", () => {
  it("crosses at its cruise speed", async () => {
    const h = await playing();
    h.debug.addSaucer(200, 120);
    h.debug.setSaucerMind(false);
    h.debug.setSaucerGun(false);
    await h.seconds(2);
    expect(h.debug.snapshot().saucer!.x).toBeCloseTo(200 + 2 * SAUCER_SPEED, 0);
  });

  it("weaves up and down on its own clock, at its own speed", async () => {
    const h = await playing();
    h.debug.addSaucer(200, 120);
    h.debug.setSaucerGun(false);
    h.debug.setSaucerTravel(false);

    const changes: number[] = [];
    let sign = 0;
    for (let tick = 0; tick < ticksFor(4 * SAUCER_WEAVE_INTERVAL); tick += 1) {
      await h.advance(1);
      const saucer = h.debug.snapshot().saucer!;
      expect(Math.abs(saucer.vy)).toBeLessThanOrEqual(
        SAUCER_WEAVE_SPEED * 1.05,
      );
      const next = Math.sign(saucer.vy);
      if (next !== 0 && next !== sign) {
        changes.push(tick);
        sign = next;
      }
    }
    expect(changes.length).toBeGreaterThanOrEqual(3);
    for (let index = 2; index < changes.length; index += 1) {
      const seconds = (changes[index] - changes[index - 1]) / 120;
      expect(seconds).toBeGreaterThan(SAUCER_WEAVE_INTERVAL * 0.8);
      expect(seconds).toBeLessThan(SAUCER_WEAVE_INTERVAL * 1.2);
    }
  });

  it("wraps at the top and the bottom", async () => {
    const h = await playing();
    h.debug.addSaucer(300, 8);
    h.debug.setSaucerMind(false);
    h.debug.setSaucerGun(false);
    h.debug.setSaucerVelocity(0, -300);
    await h.seconds(0.2);
    expect(h.debug.snapshot().saucer!.y).toBeGreaterThan(600);
  });

  it("is never pulled by the well", async () => {
    const h = await playing();
    h.debug.addSaucer(STAR_X + 120, STAR_Y);
    h.debug.setSaucerMind(false);
    h.debug.setSaucerGun(false);
    h.debug.setSaucerVelocity(0, 0);
    h.debug.setSaucerTravel(false);
    await h.seconds(2);
    const saucer = h.debug.snapshot().saucer!;
    expect(saucer.vx).toBe(0);
    expect(saucer.vy).toBe(0);
  });

  it(
    "never overlaps the star's core, whichever row it crosses on",
    async () => {
      const h = await playing();
      const surface = CORE_R + SAUCER_R;
      let worst = Number.POSITIVE_INFINITY;

      for (const row of [STAR_Y - 40, STAR_Y, STAR_Y + 40]) {
        for (const fromLeft of [true, false]) {
          startPlaying(h.debug);
          h.debug.addSaucer(fromLeft ? SAUCER_R : 1280 - SAUCER_R, row);
          h.debug.setSaucerGun(false);
          h.debug.setSaucerVelocity(fromLeft ? SAUCER_SPEED : -SAUCER_SPEED, 0);

          let previous = h.debug.snapshot().saucer!;
          for (let sample = 0; sample < 130; sample += 1) {
            await h.advance(8);
            const saucer = h.debug.snapshot().saucer;
            if (saucer === null) break;
            worst = Math.min(worst, segmentDistance(previous, saucer));
            previous = saucer;
          }
        }
      }
      expect(worst).toBeGreaterThan(surface);
    },
    LONG,
  );
});

/** The distance from the star's centre to the path between two samples. */
function segmentDistance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const abx = deltaX(a.x, b.x);
  const aby = deltaY(a.y, b.y);
  const apx = deltaX(a.x, STAR_X);
  const apy = deltaY(a.y, STAR_Y);
  const length = abx * abx + aby * aby;
  const t =
    length === 0
      ? 0
      : Math.max(0, Math.min(1, (apx * abx + apy * aby) / length));
  return Math.hypot(apx - abx * t, apy - aby * t);
}

describe("the saucer's gun", () => {
  it("fires on its own cadence", async () => {
    const h = await playing();
    poseGunner(h, 300, 200);

    const shots: number[] = [];
    for (
      let tick = 0;
      tick < ticksFor(5 * SAUCER_FIRE_INTERVAL + 1);
      tick += 1
    ) {
      await h.advance(1);
      if (h.debug.snapshot().enemyBullets.length > 0) {
        shots.push(tick);
        h.debug.clearEnemyBullets();
      }
    }
    expect(shots.length).toBeGreaterThanOrEqual(5);
    for (let index = 1; index < shots.length; index += 1) {
      const seconds = (shots[index] - shots[index - 1]) / 120;
      expect(seconds).toBeCloseTo(SAUCER_FIRE_INTERVAL, 1);
    }
  });

  it(
    "aims at the ship, with a fresh error inside ten degrees per shot",
    async () => {
      const h = await playing();
      h.debug.setShipPosition(300 + 400, 200);
      poseGunner(h, 300, 200);

      // A visit is finite, so the sixty shots are taken across several of them:
      // each saucer is brought back the moment its own twelve seconds run out.
      const bearings: number[] = [];
      for (let tick = 0; tick < ticksFor(160); tick += 1) {
        await h.advance(1);
        const seen = h.debug.snapshot();
        if (seen.saucer === null) {
          poseGunner(h, 300, 200);
          continue;
        }
        if (seen.enemyBullets.length === 0) continue;
        const bullet = seen.enemyBullets[0];
        bearings.push(Math.atan2(bullet.vy, bullet.vx));
        h.debug.clearEnemyBullets();
        if (bearings.length >= 60) break;
      }

      expect(bearings.length).toBe(60);
      const degree = Math.PI / 180;
      // The ship lies due right of the saucer, so the true bearing is zero.
      for (const bearing of bearings) {
        expect(Math.abs(bearing)).toBeLessThanOrEqual(SAUCER_AIM_ERROR + 1e-6);
      }
      const mean = bearings.reduce((sum, value) => sum + value, 0) / 60;
      expect(Math.abs(mean)).toBeLessThan(3 * degree);
      const spread = Math.max(...bearings) - Math.min(...bearings);
      expect(spread).toBeGreaterThan(4 * degree);
    },
    LONG,
  );

  it("its round carries its own motion", async () => {
    const h = await playing();
    h.debug.setShipPosition(700, 200);
    h.debug.addSaucer(300, 200);
    h.debug.setSaucerMind(false);
    h.debug.setSaucerTravel(false);
    h.debug.setSaucerVelocity(-70, 40);

    await h.seconds(SAUCER_FIRE_INTERVAL + 0.05);
    const bullet = h.debug.snapshot().enemyBullets[0];
    const speed = Math.hypot(bullet.vx + 70, bullet.vy - 40);
    expect(speed).toBeCloseTo(SAUCER_BULLET_SPEED, -1);
    expect(Math.abs(speed - SAUCER_BULLET_SPEED)).toBeLessThan(
      SAUCER_BULLET_SPEED * 0.03,
    );
  });

  it("fires nothing with its gun off", async () => {
    const h = await playing();
    h.debug.addSaucer(300, 200);
    h.debug.setSaucerGun(false);
    h.debug.setSaucerTravel(false);
    await h.seconds(4 * SAUCER_FIRE_INTERVAL);
    expect(h.debug.snapshot().enemyBullets).toHaveLength(0);
  });

  it("holds its centre with its travel off while its gun runs on", async () => {
    const h = await playing();
    h.debug.addSaucer(300, 200);
    h.debug.setSaucerTravel(false);
    await h.seconds(SAUCER_FIRE_INTERVAL + 0.1);
    const seen = h.debug.snapshot();
    expect(seen.saucer!.x).toBe(300);
    expect(seen.saucer!.y).toBe(200);
    expect(seen.enemyBullets.length).toBeGreaterThan(0);
  });
});

describe("a saucer bullet", () => {
  it("expires after its lifetime", async () => {
    const h = await playing();
    h.debug.addEnemyBullet(160, 120, 0, 0);
    await h.seconds(SAUCER_BULLET_LIFE - 0.1);
    expect(h.debug.snapshot().enemyBullets).toHaveLength(1);
    await h.seconds(0.2);
    expect(h.debug.snapshot().enemyBullets).toHaveLength(0);
  });

  it("passes over a rock and is absorbed by the core", async () => {
    const h = await playing();
    poseRock(h.debug, "large", 400, 200);
    h.debug.addEnemyBullet(300, 200, 600, 0);
    await h.seconds(0.3);
    let seen = h.debug.snapshot();
    expect(seen.rocks).toHaveLength(1);
    expect(seen.enemyBullets).toHaveLength(1);
    expect(seen.score).toBe(0);

    startPlaying(h.debug);
    h.debug.addEnemyBullet(STAR_X - 200, STAR_Y, 900, 0);
    await h.seconds(0.4);
    seen = h.debug.snapshot();
    expect(seen.enemyBullets).toHaveLength(0);
  });
});

describe("what harms the saucer", () => {
  it("a rock passes through it", async () => {
    const h = await playing();
    h.debug.addSaucer(400, 200);
    h.debug.setSaucerMind(false);
    h.debug.setSaucerGun(false);
    h.debug.setSaucerTravel(false);
    poseRock(h.debug, "medium", 200, 200, 300, 0);
    await h.seconds(1.2);
    const seen = h.debug.snapshot();
    expect(seen.saucer).not.toBeNull();
    expect(seen.rocks).toHaveLength(1);
  });

  it("one of the ship's rounds destroys it and scores", async () => {
    const h = await playing();
    h.debug.addSaucer(400, 200);
    h.debug.setSaucerMind(false);
    h.debug.setSaucerGun(false);
    h.debug.setSaucerTravel(false);
    h.debug.addBullet(300, 200, 600, 0);
    await h.seconds(0.3);
    const seen = h.debug.snapshot();
    expect(seen.saucer).toBeNull();
    expect(seen.bullets).toHaveLength(0);
    expect(seen.score).toBe(SCORE_SAUCER);
  });
});
