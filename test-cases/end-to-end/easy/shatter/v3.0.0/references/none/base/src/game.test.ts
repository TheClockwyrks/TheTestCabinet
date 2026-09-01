import { describe, expect, it } from "vitest";

import {
  BULLET_LIFE,
  BULLET_R,
  CORE_R,
  CUES,
  EXTRA_LIFE_STEP,
  FACE_UP,
  FIELD_H,
  FIELD_W,
  FIRE_INTERVAL_TICKS,
  INVULN_TIME,
  MAX_BULLETS,
  MUZZLE_SPEED,
  ROCK_RADIUS,
  SAFE_X,
  SAFE_Y,
  SAUCER_AIM_ERROR,
  SAUCER_BULLET_SPEED,
  SAUCER_FIRE_INTERVAL,
  SAUCER_FIRST_DELAY,
  SAUCER_LIFETIME,
  SAUCER_R,
  SAUCER_SPEED,
  SAUCER_WEAVE_INTERVAL,
  SAUCER_WEAVE_SPEED,
  SCORE_LARGE,
  SCORE_MEDIUM,
  SCORE_SAUCER,
  SCORE_SMALL,
  SHIP_DRAG_HALFLIFE,
  SHIP_MAX,
  SHIP_R,
  SHIP_THRUST,
  SHIP_TURN,
  SPLIT_KICK,
  START_LIVES,
  STAR_X,
  STAR_Y,
  TICK_DT,
  TICK_HZ,
  WAVE_BANNER_TIME,
  WAVE_BASE_ROCKS,
  WAVE_MIN_SHIP_DIST,
  WAVE_MIN_STAR_DIST,
} from "./constants";
import {
  NOSE_OFFSET,
  makeBullet,
  makeEnemyBullet,
  makeRock,
  makeSaucer,
} from "./entities";
import { wrappedDistance } from "./geometry";
import { posed, drive } from "./harness.test-support";
import { fireGun } from "./weapons";
import {
  createState,
  spawnWave,
  startNewGame,
  toTitle,
  waveSpeedScale,
} from "./world";

/** How far a field position is from the star's centre, along the direct vector. */
function distanceToStar(x: number, y: number): number {
  return Math.hypot(x - STAR_X, y - STAR_Y);
}

/**
 * The star's distance to the LINE between two samples.
 *
 * Reading the samples alone at a stride reports a body further out than it got,
 * which is the wrong direction for a measurement hunting a pass that came too
 * close.
 */
function distanceToSegment(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  // A pair of samples that straddle a seam is not a straight line between the
  // two, so it is measured as two points instead.
  if (Math.abs(b.x - a.x) > FIELD_W / 2 || Math.abs(b.y - a.y) > FIELD_H / 2) {
    return Math.min(distanceToStar(a.x, a.y), distanceToStar(b.x, b.y));
  }
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  if (length === 0) return distanceToStar(a.x, a.y);
  let t = ((STAR_X - a.x) * dx + (STAR_Y - a.y) * dy) / length;
  t = Math.max(0, Math.min(1, t));
  return distanceToStar(a.x + t * dx, a.y + t * dy);
}

describe("a new game", () => {
  it("opens at the title over an empty field", () => {
    const state = createState(1);
    expect(state.screen).toBe("title");
    expect(state.lives).toBe(START_LIVES);
    expect(state.wave).toBe(0);
    expect(state.score).toBe(0);
    expect(state.rocks).toHaveLength(0);
    expect(state.bullets).toHaveLength(0);
    expect(state.saucer).toBeNull();
    expect(state.ship).toMatchObject({ x: SAFE_X, y: SAFE_Y, angle: FACE_UP });
  });

  it("puts wave 1 up, clear of the ship and clear of the star", () => {
    const state = createState(1);
    startNewGame(state);
    expect(state.screen).toBe("playing");
    expect(state.wave).toBe(1);
    expect(state.rocks).toHaveLength(WAVE_BASE_ROCKS + 1);
    for (const rock of state.rocks) {
      expect(rock.size).toBe("large");
      expect(
        wrappedDistance(rock.x, rock.y, state.ship.x, state.ship.y),
      ).toBeGreaterThanOrEqual(WAVE_MIN_SHIP_DIST);
      expect(distanceToStar(rock.x, rock.y)).toBeGreaterThanOrEqual(
        WAVE_MIN_STAR_DIST,
      );
    }
  });

  it("clears the field of everything the previous game left", () => {
    const { state } = posed();
    state.rocks.push(makeRock(state, "small", 100, 100, 0, 0));
    state.saucer = makeSaucer(state, 200, 200, SAUCER_SPEED);
    state.enemyBullets.push(makeEnemyBullet(state, 210, 210, 0, 0));
    state.bullets.push(makeBullet(state, 220, 220, 0, 0));
    state.score = 900;
    state.lives = 1;
    startNewGame(state);
    expect(state.score).toBe(0);
    expect(state.lives).toBe(START_LIVES);
    expect(state.saucer).toBeNull();
    expect(state.enemyBullets).toHaveLength(0);
    expect(state.bullets).toHaveLength(0);
    expect(state.rocks.every((rock) => rock.size === "large")).toBe(true);
  });

  it("puts one more rock up on each later wave, drifting faster", () => {
    const state = createState(2);
    spawnWave(state, 1);
    expect(state.rocks).toHaveLength(WAVE_BASE_ROCKS + 1);
    state.rocks = [];
    spawnWave(state, 2);
    expect(state.rocks).toHaveLength(WAVE_BASE_ROCKS + 2);
    // Four per cent per wave past the first, capped at forty.
    expect(waveSpeedScale(1)).toBeCloseTo(1, 9);
    expect(waveSpeedScale(6)).toBeCloseTo(1.2, 9);
    expect(waveSpeedScale(11)).toBeCloseTo(1.4, 9);
    expect(waveSpeedScale(40)).toBeCloseTo(1.4, 9);
  });
});

describe("the ship", () => {
  it("turns at a constant rate and changes no velocity doing it", () => {
    const { state, input, advance } = posed();
    state.ship.angle = 0;
    input.hold("left");
    advance(TICK_HZ);
    expect(state.ship.angle).toBeCloseTo(-SHIP_TURN, 6);
    expect(state.ship.vx).toBe(0);
    expect(state.ship.vy).toBe(0);
    input.releaseAll();
    input.hold("right");
    advance(TICK_HZ);
    expect(state.ship.angle).toBeCloseTo(0, 6);
  });

  it("accelerates along its facing while thrust is held, and reports it", () => {
    const { state, input, advance } = posed();
    state.ship.angle = 0;
    input.hold("thrust");
    advance(1);
    expect(state.ship.thrusting).toBe(true);
    const drag = Math.pow(0.5, TICK_DT / SHIP_DRAG_HALFLIFE);
    expect(state.ship.vx).toBeCloseTo(SHIP_THRUST * TICK_DT * drag, 9);
    expect(state.ship.vy).toBeCloseTo(0, 9);
    input.releaseAll();
    advance(1);
    expect(state.ship.thrusting).toBe(false);
  });

  it("loses half its speed to drag every three seconds", () => {
    const { state, advance } = posed();
    state.ship.vx = 400;
    advance(Math.round(SHIP_DRAG_HALFLIFE * TICK_HZ));
    expect(state.ship.vx).toBeCloseTo(200, 1);
  });

  it("never passes its speed cap", () => {
    const { state, input, advance } = posed();
    state.ship.angle = 0;
    input.hold("thrust");
    advance(10 * TICK_HZ);
    expect(Math.hypot(state.ship.vx, state.ship.vy)).toBeLessThanOrEqual(
      SHIP_MAX + 1e-9,
    );
    expect(Math.hypot(state.ship.vx, state.ship.vy)).toBeGreaterThan(
      SHIP_MAX - 5,
    );
  });

  it("is never pulled by the well, however close it stands", () => {
    const { state, advance } = posed();
    state.ship.x = STAR_X;
    state.ship.y = STAR_Y - 100;
    advance(TICK_HZ);
    expect(state.ship.vx).toBe(0);
    expect(state.ship.vy).toBe(0);
    expect(state.ship.y).toBe(STAR_Y - 100);
  });

  it("wraps at the field's edges, carrying its velocity across", () => {
    const { state, advance } = posed();
    state.ship.x = FIELD_W - 1;
    state.ship.y = 1;
    state.ship.vx = 600;
    state.ship.vy = -600;
    advance(2);
    expect(state.ship.x).toBeLessThan(100);
    expect(state.ship.y).toBeGreaterThan(FIELD_H - 100);
    expect(state.ship.vx).toBeGreaterThan(0);
    expect(state.ship.vy).toBeLessThan(0);
  });

  it("slides along the core, losing its inward speed and no life", () => {
    const { state, advance } = posed();
    state.ship.x = STAR_X;
    state.ship.y = STAR_Y - (CORE_R + SHIP_R) + 2;
    state.ship.vx = 120;
    state.ship.vy = 400;
    state.ship.angle = 1.234;
    advance(1);
    expect(distanceToStar(state.ship.x, state.ship.y)).toBeCloseTo(
      CORE_R + SHIP_R,
      6,
    );
    // The inward component is gone and the tangential one is kept.
    const nx = (state.ship.x - STAR_X) / (CORE_R + SHIP_R);
    const ny = (state.ship.y - STAR_Y) / (CORE_R + SHIP_R);
    expect(state.ship.vx * nx + state.ship.vy * ny).toBeGreaterThanOrEqual(
      -1e-9,
    );
    expect(Math.hypot(state.ship.vx, state.ship.vy)).toBeGreaterThan(100);
    expect(state.ship.angle).toBe(1.234);
    expect(state.lives).toBe(START_LIVES);
    expect(state.screen).toBe("playing");
  });
});

describe("the gun", () => {
  it("takes one shot per press, from the nose, carrying the ship's velocity", () => {
    const { state, input, advance, audio } = posed();
    state.ship.angle = 0;
    state.ship.vx = 90;
    state.ship.vy = -40;
    input.tap("fire");
    advance(1);
    expect(state.bullets).toHaveLength(1);
    const bullet = state.bullets[0];
    const offset = wrappedDistance(
      bullet.x,
      bullet.y,
      state.ship.x,
      state.ship.y,
    );
    expect(offset).toBeLessThanOrEqual(SHIP_R + 1e-9);
    expect(offset).toBeCloseTo(NOSE_OFFSET, 6);
    expect(bullet.vx).toBeCloseTo(state.ship.vx + MUZZLE_SPEED, 6);
    expect(bullet.vy).toBeCloseTo(state.ship.vy, 6);
    expect(bullet.life).toBe(BULLET_LIFE);
    expect(audio.played).toContain(CUES.fire);
  });

  it("gates a held key at the fire interval", () => {
    const { state, input, advance } = posed();
    input.hold("fire");
    advance(1);
    expect(state.bullets).toHaveLength(1);
    expect(state.ship.fireCooldown).toBe(FIRE_INTERVAL_TICKS);
    advance(FIRE_INTERVAL_TICKS - 1);
    expect(state.bullets).toHaveLength(1);
    advance(1);
    expect(state.bullets).toHaveLength(2);
  });

  it("stops at the on-screen cap", () => {
    const { state, input, advance } = posed();
    // Firing well clear of the star, so the cap is what stops the roster growing
    // rather than the core absorbing the shots.
    state.ship.x = 200;
    state.ship.y = 100;
    state.ship.collision = false;
    input.hold("fire");
    advance(FIRE_INTERVAL_TICKS * MAX_BULLETS + 4);
    expect(state.bullets).toHaveLength(MAX_BULLETS);
    advance(FIRE_INTERVAL_TICKS);
    expect(state.bullets.length).toBeLessThanOrEqual(MAX_BULLETS);
  });

  it("removes a bullet the moment its life runs out", () => {
    const { state, advance } = posed();
    state.ship.collision = false;
    state.ship.x = 200;
    state.ship.y = 100;
    fireGun(state);
    expect(state.bullets).toHaveLength(1);
    let ticks = 0;
    while (state.bullets.length === 1 && ticks < 400) {
      advance(1);
      ticks += 1;
    }
    expect(state.bullets).toHaveLength(0);
    expect(Math.abs(ticks - BULLET_LIFE * TICK_HZ)).toBeLessThanOrEqual(1);
  });

  it("bends a shot toward the star", () => {
    const { state, advance } = posed();
    state.bullets.push(makeBullet(state, STAR_X - 200, STAR_Y - 200, 400, 0));
    advance(30);
    // Pulled down and to the right, toward the star's centre.
    expect(state.bullets[0].vy).toBeGreaterThan(10);
  });

  it("is absorbed by the core, scoring nothing", () => {
    const { state, advance } = posed();
    state.ship.collision = false;
    state.bullets.push(makeBullet(state, STAR_X - 120, STAR_Y, 520, 0));
    advance(60);
    expect(state.bullets).toHaveLength(0);
    expect(state.score).toBe(0);
  });
});

describe("rocks", () => {
  it("splits into two of the size below, appended in order with fresh ids", () => {
    const { state, advance } = posed();
    state.ship.collision = false;
    // Far out, so the well moves the parent's velocity as little as possible
    // over the shot, and drifting DIAGONALLY against a HORIZONTAL shot, so the
    // bullet's perpendicular and the rock's differ by construction.
    const parent = makeRock(state, "large", 320, 620, -60, -60);
    state.rocks.push(parent);
    const before = new Set(state.rocks.map((rock) => rock.id));

    let parentVelocity = { vx: parent.vx, vy: parent.vy };
    state.bullets.push(
      makeBullet(state, 320 - ROCK_RADIUS.large - BULLET_R - 3, 620, 520, 0),
    );
    for (let i = 0; i < 20 && state.rocks.length === 1; i += 1) {
      parentVelocity = { vx: state.rocks[0].vx, vy: state.rocks[0].vy };
      advance(1);
    }

    expect(state.rocks).toHaveLength(2);
    const [first, second] = state.rocks;
    expect(first.size).toBe("medium");
    expect(second.size).toBe("medium");
    expect(before.has(first.id)).toBe(false);
    expect(before.has(second.id)).toBe(false);
    expect(first.id).not.toBe(second.id);
    expect(first.x).toBeCloseTo(second.x, 9);
    expect(first.y).toBeCloseTo(second.y, 9);

    // Read off the PAIR: the average is the parent's velocity whatever the kick
    // did, and the difference is twice the kick. Within the one tick of the
    // well's pull that separates the reading from the kill, and a long way inside
    // the kick the assertion is about.
    expect(
      Math.abs((first.vx + second.vx) / 2 - parentVelocity.vx),
    ).toBeLessThan(0.5);
    expect(
      Math.abs((first.vy + second.vy) / 2 - parentVelocity.vy),
    ).toBeLessThan(0.5);
    const kickX = (first.vx - second.vx) / 2;
    const kickY = (first.vy - second.vy) / 2;
    expect(Math.hypot(kickX, kickY)).toBeCloseTo(SPLIT_KICK, 6);
    // Perpendicular to the BULLET's travel, which was horizontal — not to the
    // rock's diagonal course, whose perpendicular would put about 64 units into
    // each axis.
    expect(Math.abs(kickX)).toBeLessThan(5);
    expect(Math.abs(kickY)).toBeCloseTo(SPLIT_KICK, 1);
  });

  it("leaves nothing when a Small is destroyed, and scores each size", () => {
    const { state, advance, audio } = posed();
    state.ship.collision = false;
    for (const [size, points] of [
      ["large", SCORE_LARGE],
      ["medium", SCORE_MEDIUM],
      ["small", SCORE_SMALL],
    ] as const) {
      state.rocks = [makeRock(state, size, 300, 200, 0, 0)];
      state.bullets = [
        makeBullet(state, 300 - ROCK_RADIUS[size] - BULLET_R - 2, 200, 520, 0),
      ];
      const before = state.score;
      advance(3);
      expect(state.score - before).toBe(points);
      expect(state.rocks).toHaveLength(size === "small" ? 0 : 2);
      expect(audio.played).toContain(CUES.shatter);
    }
  });

  it("recycles a rock the star swallows, scoring nothing", () => {
    const { state, advance } = posed();
    state.ship.collision = false;
    const rock = makeRock(state, "medium", STAR_X, STAR_Y - 200, 0, 0);
    state.rocks.push(rock);
    const id = rock.id;
    advance(300);
    expect(state.rocks).toHaveLength(1);
    expect(state.rocks[0].id).toBe(id);
    expect(state.rocks[0].size).toBe("medium");
    expect(state.score).toBe(0);
    // It came back from an edge rather than staying in the core.
    expect(distanceToStar(state.rocks[0].x, state.rocks[0].y)).toBeGreaterThan(
      CORE_R + ROCK_RADIUS.medium,
    );
  });

  it("passes through another rock", () => {
    const { state, advance } = posed();
    state.ship.collision = false;
    state.rocks.push(
      makeRock(state, "large", 200, 100, 200, 0),
      makeRock(state, "large", 400, 100, -200, 0),
    );
    advance(120);
    expect(state.rocks).toHaveLength(2);
    expect(state.rocks[0].x).toBeGreaterThan(state.rocks[1].x);
  });

  it("spins without moving, so the drawn rotation stays cosmetic", () => {
    const { state, advance } = posed();
    state.ship.collision = false;
    const rock = makeRock(state, "large", 200, 100, 0, 0);
    rock.spin = 1;
    state.rocks.push(rock);
    advance(TICK_HZ);
    expect(state.rocks[0].angle).toBeCloseTo(rock.angle, 6);
  });
});

describe("the wave loop", () => {
  it("does not clear a wave when the rocks are simply taken away", () => {
    const { state, advance } = posed();
    state.waveSpawning = true;
    state.rocks.push(makeRock(state, "small", 200, 200, 0, 0));
    advance(1);
    state.rocks = [];
    advance(60);
    expect(state.wave).toBe(1);
    expect(state.waveBanner).toBe(0);
    expect(state.rocks).toHaveLength(0);
  });

  it("turns the wave over on the tick the last rock is shot down", () => {
    const { state, advance } = posed();
    state.ship.collision = false;
    state.waveSpawning = true;
    state.rocks = [makeRock(state, "small", 300, 200, 0, 0)];
    state.bullets = [
      makeBullet(state, 300 - ROCK_RADIUS.small - BULLET_R - 2, 200, 520, 0),
    ];

    // Find the tick the last rock came apart on.
    let cleared = false;
    for (let i = 0; i < 10 && !cleared; i += 1) {
      advance(1);
      cleared = state.waveBanner > 0;
    }
    expect(cleared).toBe(true);
    expect(state.wave).toBe(2);
    expect(state.rocks).toHaveLength(0);
    // The banner is raised at its full length on the tick of the clear and runs
    // down from the next one, which is the convention `src/waves.ts` uses.
    expect(state.waveBanner).toBeCloseTo(WAVE_BANNER_TIME, 9);

    // No rock is on the field at any point while the banner runs, and the wave
    // it announced arrives as it ends.
    let bannerTicks = 1;
    while (state.waveBanner > 0 && bannerTicks < 400) {
      expect(state.rocks).toHaveLength(0);
      advance(1);
      bannerTicks += 1;
    }
    expect(
      Math.abs(bannerTicks - WAVE_BANNER_TIME * TICK_HZ),
    ).toBeLessThanOrEqual(1);
    expect(state.waveBanner).toBe(0);
    expect(state.rocks).toHaveLength(WAVE_BASE_ROCKS + 2);
  });

  it("keeps an emptied field empty while the wave gate is off", () => {
    const { state, advance } = posed();
    state.ship.collision = false;
    state.rocks = [makeRock(state, "small", 300, 200, 0, 0)];
    state.bullets = [
      makeBullet(state, 300 - ROCK_RADIUS.small - BULLET_R - 2, 200, 520, 0),
    ];
    advance(400);
    expect(state.wave).toBe(1);
    expect(state.rocks).toHaveLength(0);
    expect(state.waveBanner).toBe(0);
  });

  it("keeps the ship flying while the banner runs", () => {
    const { state, advance } = posed();
    state.ship.collision = false;
    state.ship.vx = 200;
    state.waveBanner = WAVE_BANNER_TIME;
    const before = state.ship.x;
    advance(60);
    expect(state.waveBanner).toBeGreaterThan(0);
    expect(state.ship.x).toBeGreaterThan(before + 50);
  });
});

describe("the saucer", () => {
  it("arrives on the game's own clock, and not before", () => {
    const { state, advance, audio } = posed();
    state.ship.collision = false;
    state.saucerSpawning = true;
    advance(Math.round(SAUCER_FIRST_DELAY * TICK_HZ) - 2);
    expect(state.saucer).toBeNull();
    advance(4);
    expect(state.saucer).not.toBeNull();
    expect(audio.played).toContain(CUES.saucer);
  });

  it("leaves the field after its lifetime", () => {
    const { state, advance } = posed();
    state.ship.collision = false;
    state.saucer = makeSaucer(state, 200, 200, SAUCER_SPEED);
    state.saucer.gun = false;
    const id = state.saucer.id;
    advance(Math.round(SAUCER_LIFETIME * TICK_HZ) - 2);
    expect(state.saucer?.id).toBe(id);
    advance(4);
    expect(state.saucer).toBeNull();
  });

  it("gives every arrival an id of its own", () => {
    const { state } = posed();
    const first = makeSaucer(state, 100, 100, SAUCER_SPEED);
    state.saucer = first;
    const second = makeSaucer(state, 100, 100, SAUCER_SPEED);
    state.saucer = second;
    expect(second.id).not.toBe(first.id);
  });

  it("rerolls its weave on its own interval, reversing each time", () => {
    const { state, advance } = posed();
    state.ship.collision = false;
    state.saucer = makeSaucer(state, 200, 200, SAUCER_SPEED);
    state.saucer.gun = false;
    state.saucer.travel = false;
    const interval = SAUCER_WEAVE_INTERVAL * TICK_HZ;

    let ticks = 0;
    while (state.saucer.vy === 0 && ticks < 400) {
      advance(1);
      ticks += 1;
    }
    expect(Math.abs(ticks - interval)).toBeLessThanOrEqual(1);
    const first = state.saucer.vy;
    expect(Math.abs(first)).toBeCloseTo(SAUCER_WEAVE_SPEED, 9);

    let again = 0;
    while (state.saucer.vy === first && again < 400) {
      advance(1);
      again += 1;
    }
    expect(Math.abs(again - interval)).toBeLessThanOrEqual(1);
    expect(state.saucer.vy).toBeCloseTo(-first, 9);
  });

  it("holds its course with its mind off, and holds its ground with travel off", () => {
    const { state, advance } = posed();
    state.ship.collision = false;
    state.saucer = makeSaucer(state, 200, 200, SAUCER_SPEED);
    state.saucer.mind = false;
    state.saucer.gun = false;
    advance(2 * TICK_HZ);
    expect(state.saucer?.vy).toBe(0);
    expect(state.saucer?.x).toBeCloseTo(200 + SAUCER_SPEED * 2, 4);

    state.saucer = makeSaucer(state, 400, 300, SAUCER_SPEED);
    state.saucer.gun = false;
    state.saucer.travel = false;
    advance(2 * TICK_HZ);
    expect(state.saucer?.x).toBe(400);
    expect(state.saucer?.y).toBe(300);
  });

  it("fires an aimed shot on its own interval, within its error", () => {
    const { state, advance } = posed();
    state.ship.collision = false;
    // Off the star's column, and inside half the field's height of the saucer, so
    // the shortest wrapped path to the ship is straight down the field.
    state.ship.x = 200;
    state.ship.y = 500;
    state.saucer = makeSaucer(state, 200, 200, SAUCER_SPEED);
    state.saucer.mind = false;
    state.saucer.travel = false;
    const interval = SAUCER_FIRE_INTERVAL * TICK_HZ;
    const bearings: number[] = [];

    // Six shots: the whole of them inside the saucer's own twelve-second visit.
    for (let shot = 0; shot < 6; shot += 1) {
      let ticks = 0;
      while (state.enemyBullets.length === 0 && ticks < 400) {
        advance(1);
        ticks += 1;
      }
      expect(Math.abs(ticks - interval)).toBeLessThanOrEqual(1);
      expect(state.enemyBullets).toHaveLength(1);
      const bullet = state.enemyBullets[0];
      const saucer = state.saucer;
      expect(saucer).not.toBeNull();
      if (saucer === null) return;
      // It leaves from the saucer, carrying the saucer's own velocity, so the
      // shot's speed is read after that is taken back off.
      expect(bullet.x).toBeCloseTo(saucer.x, 9);
      expect(bullet.y).toBeCloseTo(saucer.y, 9);
      const aimX = bullet.vx - saucer.vx;
      const aimY = bullet.vy - saucer.vy;
      expect(Math.hypot(aimX, aimY)).toBeCloseTo(SAUCER_BULLET_SPEED, 4);
      bearings.push(Math.atan2(aimY, aimX));
      // Taken off the field, so the next interval is read on its own.
      state.enemyBullets = [];
    }

    const straight = Math.PI / 2;
    for (const bearing of bearings) {
      expect(Math.abs(bearing - straight)).toBeLessThanOrEqual(
        SAUCER_AIM_ERROR + 1e-9,
      );
    }
    // Drawn afresh for every shot, so successive shots at a still ship differ.
    expect(new Set(bearings.map((bearing) => bearing.toFixed(9))).size).toBe(
      bearings.length,
    );
  });

  it("fires nothing with its gun off, while it steers and travels on", () => {
    const { state, advance } = posed();
    state.ship.collision = false;
    state.saucer = makeSaucer(state, 200, 200, SAUCER_SPEED);
    state.saucer.gun = false;
    advance(Math.round(4 * SAUCER_FIRE_INTERVAL * TICK_HZ));
    expect(state.enemyBullets).toHaveLength(0);
    expect(state.saucer).not.toBeNull();
  });

  it("is destroyed by one of the ship's bullets, and scores", () => {
    const { state, advance } = posed();
    state.ship.collision = false;
    state.saucer = makeSaucer(state, 400, 300, 0);
    state.saucer.gun = false;
    state.saucer.mind = false;
    state.bullets = [
      makeBullet(state, 400 - SAUCER_R - BULLET_R - 2, 300, 520, 0),
    ];
    advance(3);
    expect(state.saucer).toBeNull();
    expect(state.bullets).toHaveLength(0);
    expect(state.score).toBe(SCORE_SAUCER);
  });

  it("steers clear of the core across every crossing the game can produce", () => {
    let worst = Infinity;
    for (const seedValue of [1, 2, 3]) {
      for (let row = STAR_Y - 80; row <= STAR_Y + 80; row += 20) {
        for (const direction of [1, -1]) {
          const { state, advance } = posed(seedValue);
          state.ship.collision = false;
          // Far from the crossing, so nothing else takes part in it.
          state.ship.x = 40;
          state.ship.y = 40;
          state.saucer = makeSaucer(
            state,
            direction > 0 ? 0 : FIELD_W,
            row,
            direction * SAUCER_SPEED,
          );
          // The steering is the requirement; with the gun off the crossing
          // produces no saucer bullets at all.
          state.saucer.gun = false;
          let previous = { x: state.saucer.x, y: state.saucer.y };
          for (let step = 0; step < 200; step += 1) {
            advance(8);
            const saucer = state.saucer;
            if (saucer === null) break;
            worst = Math.min(
              worst,
              distanceToSegment(previous, { x: saucer.x, y: saucer.y }),
            );
            previous = { x: saucer.x, y: saucer.y };
          }
          expect(state.enemyBullets).toHaveLength(0);
        }
      }
    }
    // Never overlapping the core is the requirement `specs/saucer.md` states.
    expect(worst).toBeGreaterThan(CORE_R + SAUCER_R);
  });
});

describe("lives and the run", () => {
  it("costs a life and respawns at the safe point under grace", () => {
    const { state, advance, audio } = posed();
    state.ship.x = 300;
    state.ship.y = 300;
    state.rocks.push(makeRock(state, "large", 300, 300, 0, 0));
    advance(1);
    expect(state.lives).toBe(START_LIVES - 1);
    expect(state.ship.x).toBe(SAFE_X);
    expect(state.ship.y).toBe(SAFE_Y);
    expect(state.ship.angle).toBe(FACE_UP);
    expect(state.ship.invuln).toBeCloseTo(INVULN_TIME - TICK_DT, 9);
    expect(audio.played).toContain(CUES.death);
  });

  it("ignores lethal contact while the grace runs, and resumes as it ends", () => {
    const { state, advance } = posed();
    state.ship.x = 300;
    state.ship.y = 300;
    // A short grace, so the well has not carried the rock off the ship by the
    // time the tick under test comes round.
    const grace = 0.5;
    state.ship.invuln = grace;
    state.rocks.push(makeRock(state, "large", 300, 300, 0, 0));

    let ticks = 0;
    while (state.ship.invuln > 0 && ticks < 200) {
      advance(1);
      ticks += 1;
    }
    expect(Math.abs(ticks - grace * TICK_HZ)).toBeLessThanOrEqual(1);
    expect(state.lives).toBe(START_LIVES);
    advance(1);
    expect(state.lives).toBe(START_LIVES - 1);
  });

  it("leaves the ship alone entirely while its contact gate is off", () => {
    const { state, advance } = posed();
    state.ship.x = 300;
    state.ship.y = 300;
    state.ship.collision = false;
    state.rocks.push(makeRock(state, "large", 300, 300, 0, 0));
    state.saucer = makeSaucer(state, 300, 300, 0);
    state.saucer.gun = false;
    state.saucer.mind = false;
    state.saucer.travel = false;
    advance(60);
    expect(state.lives).toBe(START_LIVES);
    expect(state.screen).toBe("playing");
  });

  it("ends the game when the last ship is lost", () => {
    const { state, advance } = posed();
    state.lives = 1;
    state.ship.x = 300;
    state.ship.y = 300;
    state.rocks.push(makeRock(state, "large", 300, 300, 0, 0));
    advance(1);
    expect(state.lives).toBe(0);
    expect(state.screen).toBe("gameover");
  });

  it("costs a life to the saucer itself", () => {
    const { state, advance } = posed();
    state.ship.x = 300;
    state.ship.y = 300;
    state.saucer = makeSaucer(state, 300, 300, 0);
    state.saucer.gun = false;
    state.saucer.mind = false;
    state.saucer.travel = false;
    advance(1);
    expect(state.lives).toBe(START_LIVES - 1);
  });

  it("costs a life to a saucer bullet, which is removed with it", () => {
    const { state, advance } = posed();
    state.ship.x = 300;
    state.ship.y = 300;
    state.enemyBullets.push(makeEnemyBullet(state, 300, 300, 0, 0));
    advance(1);
    expect(state.lives).toBe(START_LIVES - 1);
    expect(state.enemyBullets).toHaveLength(0);
  });

  it("catches a fast approach that would pass clean through in a tick", () => {
    const { state, advance } = posed();
    state.ship.x = 300;
    state.ship.y = 300;
    // A Small closing at 1200 units a second covers ten units in a tick, so a
    // rock posed just outside contact ends the tick just past the ship.
    state.rocks.push(makeRock(state, "small", 300 - 40, 300, 1200, 0));
    advance(3);
    expect(state.lives).toBe(START_LIVES - 1);
  });
});

describe("the score", () => {
  it("grants a ship each time play carries it across a multiple", () => {
    const { state, advance, audio } = posed();
    state.ship.collision = false;
    state.score = EXTRA_LIFE_STEP - SCORE_SMALL;
    state.rocks = [makeRock(state, "small", 300, 200, 0, 0)];
    state.bullets = [
      makeBullet(state, 300 - ROCK_RADIUS.small - BULLET_R - 2, 200, 520, 0),
    ];
    advance(3);
    expect(state.score).toBe(EXTRA_LIFE_STEP);
    expect(state.lives).toBe(START_LIVES + 1);
    expect(audio.played).toContain(CUES.extraLife);
    expect(state.extraLifeShow).toBeGreaterThan(0.5);
  });

  it("only ever rises", () => {
    const { state, advance } = posed();
    state.ship.collision = false;
    state.score = 40;
    state.rocks.push(makeRock(state, "large", STAR_X, STAR_Y - 200, 0, 0));
    advance(400);
    expect(state.score).toBe(40);
  });
});

describe("the screens", () => {
  it("moves a menu's highlight with a wrap at both ends", () => {
    const { state, tap } = drive();
    expect(state.menuIndex).toBe(0);
    tap("menu-down");
    expect(state.menuIndex).toBe(1);
    tap("menu-down");
    expect(state.menuIndex).toBe(0);
    tap("menu-up");
    expect(state.menuIndex).toBe(1);
  });

  it("plays from the title, and reads the how-to and comes back", () => {
    const { state, tap } = drive();
    tap("menu-down");
    tap("confirm");
    expect(state.screen).toBe("howto");
    tap("back");
    expect(state.screen).toBe("title");
    expect(state.menuIndex).toBe(0);
    tap("confirm");
    expect(state.screen).toBe("playing");
    expect(state.wave).toBe(1);
  });

  it("pauses, advances nothing, and resumes exactly where it stood", () => {
    const { state, advance, tap } = posed();
    state.ship.collision = false;
    state.ship.vx = 200;
    state.rocks.push(makeRock(state, "large", 400, 400, 100, 0));
    state.saucer = makeSaucer(state, 700, 300, SAUCER_SPEED);
    advance(1);
    tap("pause");
    expect(state.screen).toBe("paused");

    const frozen = {
      ship: { ...state.ship },
      rock: { ...state.rocks[0] },
      saucer: { ...state.saucer },
      enemyBullets: state.enemyBullets.length,
      simTime: state.simTime,
    };
    advance(240);
    expect(state.ship).toEqual(frozen.ship);
    expect(state.rocks[0]).toEqual(frozen.rock);
    expect(state.saucer).toEqual(frozen.saucer);
    expect(state.enemyBullets).toHaveLength(frozen.enemyBullets);
    // The clock counts the ticks the game ran, not the play it ran.
    expect(state.simTime).toBeCloseTo(frozen.simTime + 240 * TICK_DT, 9);

    tap("back");
    expect(state.screen).toBe("playing");
    // It picks up from where it stood rather than catching up on the pause.
    expect(state.ship.x).toBeGreaterThan(frozen.ship.x);
    expect(state.ship.x).toBeLessThan(frozen.ship.x + 5);
  });

  it("restarts and quits from the pause menu", () => {
    const { state, tap } = posed();
    state.ship.collision = false;
    state.score = 500;
    state.lives = 1;
    tap("pause");
    tap("menu-down");
    tap("confirm");
    expect(state.screen).toBe("playing");
    expect(state.score).toBe(0);
    expect(state.lives).toBe(START_LIVES);
    expect(state.saucer).toBeNull();

    tap("pause");
    tap("menu-up");
    tap("confirm");
    expect(state.screen).toBe("title");
  });

  it("plays again and returns to the menu from game over", () => {
    const { state, tap } = posed();
    state.screen = "gameover";
    state.menuIndex = 0;
    tap("confirm");
    expect(state.screen).toBe("playing");
    state.screen = "gameover";
    state.menuIndex = 1;
    tap("confirm");
    expect(state.screen).toBe("title");
  });

  it("returns to the title over a field cleared of everything", () => {
    const { state, advance } = posed();
    state.rocks.push(makeRock(state, "large", 100, 100, 0, 0));
    state.saucer = makeSaucer(state, 200, 200, SAUCER_SPEED);
    toTitle(state);
    advance(1);
    expect(state.rocks).toHaveLength(0);
    expect(state.saucer).toBeNull();
    expect(state.screen).toBe("title");
  });
});

describe("sound", () => {
  it("toggles muting from every screen, and reports it back", () => {
    const { state, audio, tap } = drive();
    for (const screen of ["title", "playing", "paused", "gameover"] as const) {
      state.screen = screen;
      const before = audio.muted();
      tap("mute");
      expect(audio.muted()).toBe(!before);
      expect(state.muted).toBe(!before);
    }
  });

  it("holds the thrust cue for as long as thrust is applied", () => {
    const { input, advance, audio } = posed();
    advance(1);
    expect(audio.holding.has(CUES.thrust)).toBe(false);
    input.hold("thrust");
    advance(30);
    expect(audio.holding.has(CUES.thrust)).toBe(true);
    // Held, not re-fired: the cue is opened once, never played as a blip.
    expect(audio.played.filter((cue) => cue === CUES.thrust)).toHaveLength(0);
    input.releaseAll();
    advance(1);
    expect(audio.holding.has(CUES.thrust)).toBe(false);
  });

  it("stops the thrust cue the moment the game is paused", () => {
    const { state, input, advance, audio, tap } = posed();
    input.hold("thrust");
    advance(5);
    expect(audio.holding.has(CUES.thrust)).toBe(true);
    tap("pause");
    expect(state.screen).toBe("paused");
    expect(audio.holding.has(CUES.thrust)).toBe(false);
  });
});
