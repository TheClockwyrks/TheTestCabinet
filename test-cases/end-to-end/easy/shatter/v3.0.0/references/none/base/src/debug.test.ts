import { describe, expect, it } from "vitest";

import {
  BULLET_LIFE,
  FACE_UP,
  FIELD_H,
  FIELD_W,
  ROCK_RADIUS,
  SAFE_X,
  SAFE_Y,
  SAUCER_BULLET_LIFE,
  SAUCER_FIRE_INTERVAL,
  SAUCER_R,
  SAUCER_SPEED,
  SHATTER_DEBUG_VERSION,
  START_LIVES,
  STAR_X,
  STAR_Y,
  TICK_HZ,
  WAVE_BANNER_TIME,
} from "./constants";
import { createDebugApi, type ShatterDebugApi } from "./debug";
import { makeRock, makeSaucer } from "./entities";
import { TestClock, posed } from "./harness.test-support";
import type { ShatterState } from "./types";

/** A posed game, the surface over it, and the clock stand-in behind that. */
function surface(): {
  state: ShatterState;
  api: ShatterDebugApi;
  clock: TestClock;
  advance: (ticks: number) => void;
} {
  const driven = posed();
  const clock = new TestClock();
  return {
    state: driven.state,
    api: createDebugApi(driven.state, clock),
    clock,
    advance: driven.advance,
  };
}

describe("the surface itself", () => {
  it("reports its version, on the object and in the snapshot", () => {
    const { api } = surface();
    expect(api.version).toBe(SHATTER_DEBUG_VERSION);
    expect(api.snapshot().version).toBe(SHATTER_DEBUG_VERSION);
  });

  it("changes nothing when it is read", () => {
    const { state, api } = surface();
    state.rocks.push(makeRock(state, "large", 200, 200, 10, 20));
    const before = JSON.stringify(api.snapshot());
    api.snapshot();
    api.snapshot();
    expect(JSON.stringify(api.snapshot())).toBe(before);
  });
});

describe("the clock", () => {
  it("hands both of its operations to the runtime", () => {
    const { api, clock } = surface();
    expect(api.snapshot().autoStep).toBe(true);
    api.setAutoStep(false);
    expect(clock.autoStep()).toBe(false);
    expect(api.snapshot().autoStep).toBe(false);
    api.advance(7);
    api.advance(0);
    expect(clock.advances).toEqual([7, 0]);
  });
});

describe("the screen and the run", () => {
  it("sets each field and reports it back", () => {
    const { api } = surface();
    api.setScreen("gameover");
    api.setMenuIndex(2);
    api.setScore(4321);
    api.setLives(2);
    api.setWave(9);
    api.setWaveBanner(WAVE_BANNER_TIME);
    expect(api.snapshot()).toMatchObject({
      screen: "gameover",
      menuIndex: 2,
      score: 4321,
      lives: 2,
      wave: 9,
      waveBanner: WAVE_BANNER_TIME,
    });
  });

  it("grants no ship for a score posed across a multiple", () => {
    const { api } = surface();
    api.setScore(25_000);
    expect(api.snapshot().lives).toBe(START_LIVES);
  });

  it("spawns nothing when the wave number is posed", () => {
    const { api } = surface();
    api.setWave(4);
    expect(api.snapshot().rocks).toHaveLength(0);
  });

  it("arms no wave behind a posed banner, so it simply runs out", () => {
    const { api, advance } = surface();
    api.setWaveBanner(0.1);
    advance(Math.round(0.1 * TICK_HZ) + 2);
    expect(api.snapshot().waveBanner).toBe(0);
    expect(api.snapshot().rocks).toHaveLength(0);
  });
});

describe("the world gates", () => {
  it("sets each gate and reports it back", () => {
    const { api } = surface();
    api.setWaveSpawning(false);
    api.setSaucerSpawning(false);
    expect(api.snapshot().waveSpawning).toBe(false);
    expect(api.snapshot().saucerSpawning).toBe(false);
    api.setWaveSpawning(true);
    api.setSaucerSpawning(true);
    expect(api.snapshot().waveSpawning).toBe(true);
    expect(api.snapshot().saucerSpawning).toBe(true);
  });
});

describe("the ship", () => {
  it("sets each field and reports it back", () => {
    const { api } = surface();
    api.setShipPosition(120, 240);
    api.setShipVelocity(-30, 45);
    api.setShipAngle(1.25);
    api.setShipInvuln(2);
    api.setFireCooldown(11);
    api.setShipCollision(false);
    expect(api.snapshot().ship).toMatchObject({
      x: 120,
      y: 240,
      vx: -30,
      vy: 45,
      angle: 1.25,
      invuln: 2,
      fireCooldown: 11,
      collision: false,
    });
    // Built at the call from the velocity beside it.
    expect(api.snapshot().ship.speed).toBeCloseTo(Math.hypot(30, 45), 9);
  });

  it("changes no velocity when only the facing is set", () => {
    const { api } = surface();
    api.setShipVelocity(80, 0);
    api.setShipAngle(2);
    expect(api.snapshot().ship.vx).toBe(80);
    expect(api.snapshot().ship.vy).toBe(0);
  });
});

describe("the rosters", () => {
  it("appends a bullet with a full life and a fresh id, and removes it", () => {
    const { api } = surface();
    api.addBullet(100, 100, 10, 0);
    api.addBullet(200, 200, 0, 10);
    const bullets = api.snapshot().bullets;
    expect(bullets).toHaveLength(2);
    expect(bullets[1]).toMatchObject({ x: 200, y: 200, life: BULLET_LIFE });
    expect(bullets[0].id).not.toBe(bullets[1].id);
    api.removeBullet(bullets[0].id);
    expect(api.snapshot().bullets.map((b) => b.id)).toEqual([bullets[1].id]);
    api.clearBullets();
    expect(api.snapshot().bullets).toHaveLength(0);
  });

  it("appends a saucer bullet on the same terms", () => {
    const { api } = surface();
    api.addEnemyBullet(300, 300, 0, 50);
    const shots = api.snapshot().enemyBullets;
    expect(shots).toHaveLength(1);
    expect(shots[0]).toMatchObject({ life: SAUCER_BULLET_LIFE });
    api.removeEnemyBullet(shots[0].id);
    expect(api.snapshot().enemyBullets).toHaveLength(0);
    api.addEnemyBullet(300, 300, 0, 50);
    api.clearEnemyBullets();
    expect(api.snapshot().enemyBullets).toHaveLength(0);
  });

  it("adds a rock at rest, at the radius its size fixes", () => {
    const { api } = surface();
    api.addRock("medium", 400, 500);
    const rock = api.snapshot().rocks[0];
    expect(rock).toMatchObject({
      x: 400,
      y: 500,
      vx: 0,
      vy: 0,
      size: "medium",
      radius: ROCK_RADIUS.medium,
    });
    api.setRockVelocity(rock.id, -70, 20);
    expect(api.snapshot().rocks[0]).toMatchObject({ vx: -70, vy: 20 });
    api.removeRock(rock.id);
    expect(api.snapshot().rocks).toHaveLength(0);
  });

  it("empties one roster and leaves the others standing", () => {
    const { state, api } = surface();
    api.addRock("small", 100, 100);
    api.addBullet(110, 110, 0, 0);
    api.addEnemyBullet(120, 120, 0, 0);
    state.saucer = makeSaucer(state, 130, 130, SAUCER_SPEED);
    api.clearRocks();
    const shot = api.snapshot();
    expect(shot.rocks).toHaveLength(0);
    expect(shot.bullets).toHaveLength(1);
    expect(shot.enemyBullets).toHaveLength(1);
    expect(shot.saucer).not.toBeNull();
  });

  it("destroys nothing when the rocks are cleared, so no wave turns over", () => {
    const { state, api, advance } = surface();
    api.setWaveSpawning(true);
    api.addRock("small", 200, 200);
    advance(1);
    api.clearRocks();
    advance(120);
    expect(api.snapshot().wave).toBe(1);
    expect(api.snapshot().waveBanner).toBe(0);
    expect(state.score).toBe(0);
  });

  it("ignores an id nothing holds", () => {
    const { api } = surface();
    expect(() => {
      api.setRockVelocity(9999, 1, 1);
      api.removeRock(9999);
      api.removeBullet(9999);
      api.removeEnemyBullet(9999);
    }).not.toThrow();
  });
});

describe("the saucer", () => {
  it("brings one on at cruise with all three faculties running", () => {
    const { api } = surface();
    api.addSaucer(300, 400);
    const saucer = api.snapshot().saucer;
    expect(saucer).toMatchObject({
      x: 300,
      y: 400,
      vx: SAUCER_SPEED,
      vy: 0,
      mind: true,
      gun: true,
      travel: true,
    });
  });

  it("replaces one already up, with a fresh id", () => {
    const { api } = surface();
    api.addSaucer(300, 400);
    const first = api.snapshot().saucer;
    api.addSaucer(500, 200);
    const second = api.snapshot().saucer;
    expect(second?.id).not.toBe(first?.id);
    expect(second).toMatchObject({ x: 500, y: 200 });
  });

  it("sets each faculty and reports it back", () => {
    const { api } = surface();
    api.addSaucer(300, 400);
    api.setSaucerVelocity(-140, 30);
    api.setSaucerMind(false);
    api.setSaucerGun(false);
    api.setSaucerTravel(false);
    expect(api.snapshot().saucer).toMatchObject({
      vx: -140,
      vy: 30,
      mind: false,
      gun: false,
      travel: false,
    });
    api.removeSaucer();
    expect(api.snapshot().saucer).toBeNull();
  });

  it("does nothing to a saucer that is not up", () => {
    const { api } = surface();
    expect(() => {
      api.setSaucerVelocity(1, 1);
      api.setSaucerMind(false);
      api.setSaucerGun(false);
      api.setSaucerTravel(false);
      api.removeSaucer();
    }).not.toThrow();
    expect(api.snapshot().saucer).toBeNull();
  });
});

describe("reset", () => {
  it("returns every declared field to its title-screen value", () => {
    const { state, api } = surface();
    api.setScreen("playing");
    api.setScore(500);
    api.setLives(1);
    api.setWave(5);
    api.setWaveBanner(1);
    api.setMenuIndex(2);
    api.addRock("large", 100, 100);
    api.addBullet(110, 110, 0, 0);
    api.addEnemyBullet(120, 120, 0, 0);
    api.addSaucer(130, 130);
    api.setShipPosition(10, 20);
    api.setShipVelocity(300, 300);
    api.setShipAngle(2);
    api.setShipInvuln(2);
    api.setFireCooldown(9);
    api.setShipCollision(false);
    api.setWaveSpawning(false);
    api.setSaucerSpawning(false);
    state.simTime = 12;

    api.reset();

    expect(api.snapshot()).toMatchObject({
      screen: "title",
      menuIndex: 0,
      score: 0,
      lives: START_LIVES,
      wave: 0,
      waveBanner: 0,
      waveSpawning: true,
      saucerSpawning: true,
      saucer: null,
      simTime: 0,
    });
    expect(api.snapshot().rocks).toHaveLength(0);
    expect(api.snapshot().bullets).toHaveLength(0);
    expect(api.snapshot().enemyBullets).toHaveLength(0);
    expect(api.snapshot().ship).toMatchObject({
      x: SAFE_X,
      y: SAFE_Y,
      vx: 0,
      vy: 0,
      angle: FACE_UP,
      invuln: 0,
      fireCooldown: 0,
      collision: true,
    });
  });

  it("leaves muting exactly as it stands", () => {
    const { state, api } = surface();
    state.muted = true;
    api.reset();
    expect(api.snapshot().muted).toBe(true);
  });

  it("clears every posed draw", () => {
    const { state, api } = surface();
    api.setNextSaucerEdge("right");
    api.setNextSaucerRow(300);
    api.setNextSaucerAim(0.1);
    api.setNextRockSpeed(90);
    api.setNextRecycleEdge("top");
    api.reset();
    expect(state.nextSaucerEdge).toBeNull();
    expect(state.nextSaucerRow).toBeNull();
    expect(state.nextSaucerAim).toBeNull();
    expect(state.nextRockSpeed).toBeNull();
    expect(state.nextRecycleEdge).toBeNull();
  });

  it("leaves the clock alone", () => {
    const { api, clock } = surface();
    api.setAutoStep(false);
    api.reset();
    expect(clock.autoStep()).toBe(false);
  });
});

describe("the posed draws", () => {
  it("reports each pose until the draw that consumes it", () => {
    const { state, api } = surface();
    api.setNextSaucerEdge("right");
    api.setNextSaucerRow(300);
    api.setNextSaucerAim(0.1);
    api.setNextRockSpeed(90);
    api.setNextRecycleEdge("top");
    const s = api.snapshot();
    expect(s.nextSaucerEdge).toBe("right");
    expect(s.nextSaucerRow).toBe(300);
    expect(s.nextSaucerAim).toBe(0.1);
    expect(s.nextRockSpeed).toBe(90);
    expect(s.nextRecycleEdge).toBe("top");
    expect(state.nextSaucerEdge).toBe("right");
  });

  it("ignores a value the draw could not decide", () => {
    const { api } = surface();
    api.setNextSaucerEdge("top" as unknown as "left");
    api.setNextRecycleEdge("sideways" as unknown as "top");
    api.setNextRockSpeed(-5);
    api.setNextSaucerRow(Number.NaN);
    const s = api.snapshot();
    expect(s.nextSaucerEdge).toBeNull();
    expect(s.nextRecycleEdge).toBeNull();
    expect(s.nextRockSpeed).toBeNull();
    expect(s.nextSaucerRow).toBeNull();
  });

  it("brings the next arrival in at the posed edge and row", () => {
    const { state, api, advance } = surface();
    api.setNextSaucerEdge("right");
    api.setNextSaucerRow(333);
    api.setSaucerSpawning(true);
    api.setSaucerDue(0.5);
    advance(Math.round(0.5 * TICK_HZ) + 1);
    expect(state.saucer).not.toBeNull();
    // Read within a tick of the arrival, so the craft is still at the seam.
    expect(state.saucer?.x).toBeCloseTo(FIELD_W - SAUCER_R, -1);
    expect(state.saucer?.y).toBe(333);
    expect(state.saucer?.vx).toBe(-SAUCER_SPEED);
    expect(api.snapshot().nextSaucerEdge).toBeNull();
    expect(api.snapshot().nextSaucerRow).toBeNull();
  });

  it("fires the next shot with the posed aim error", () => {
    const { state, api, advance } = surface();
    state.ship.x = 200;
    state.ship.y = 360;
    api.addSaucer(600, 360);
    api.setSaucerTravel(false);
    api.setSaucerMind(false);
    api.setNextSaucerAim(0);
    advance(Math.round(SAUCER_FIRE_INTERVAL * TICK_HZ) + 1);
    expect(state.enemyBullets).toHaveLength(1);
    const round = state.enemyBullets[0];
    // Straight at the ship, to the left, with the saucer at rest.
    expect(round.vy).toBeCloseTo(0, 6);
    expect(round.vx).toBeLessThan(0);
    expect(api.snapshot().nextSaucerAim).toBeNull();
  });

  it("gives every rock of the next wave the posed base speed", () => {
    const { state, api, advance } = surface();
    api.setWaveSpawning(true);
    api.setWave(6);
    api.setNextRockSpeed(100);
    api.setWaveBanner(0.1);
    // Read on the tick the wave arrives, so at most one tick of the well is in
    // the reading: under a unit per second at the closest a wave may spawn.
    for (let tick = 0; tick <= Math.round(0.1 * TICK_HZ) + 1; tick += 1) {
      if (state.rocks.length > 0) break;
      advance(1);
    }
    expect(state.rocks.length).toBeGreaterThan(0);
    for (const rock of state.rocks) {
      expect(Math.abs(Math.hypot(rock.vx, rock.vy) - 120)).toBeLessThanOrEqual(
        2,
      );
    }
    expect(api.snapshot().nextRockSpeed).toBeNull();
  });

  it("recycles the next rock the star takes at the posed edge and speed", () => {
    const { state, api, advance } = surface();
    api.addRock("large", STAR_X, STAR_Y);
    api.setNextRecycleEdge("bottom");
    api.setNextRockSpeed(80);
    advance(1);
    const rock = state.rocks[0];
    expect(rock.y).toBeCloseTo(FIELD_H, 0);
    expect(rock.vy).toBeLessThan(0);
    expect(Math.hypot(rock.vx, rock.vy)).toBeCloseTo(80, 0);
    expect(api.snapshot().nextRecycleEdge).toBeNull();
    expect(api.snapshot().nextRockSpeed).toBeNull();
  });

  it("poses the saucer's weave direction and the cadence's due", () => {
    const { api } = surface();
    api.addSaucer(300, 300);
    expect(api.snapshot().saucer?.weave).toBe(1);
    api.setSaucerWeave(-1);
    expect(api.snapshot().saucer?.weave).toBe(-1);
    api.setSaucerDue(27.5);
    expect(api.snapshot().saucerDue).toBe(27.5);
  });
});
