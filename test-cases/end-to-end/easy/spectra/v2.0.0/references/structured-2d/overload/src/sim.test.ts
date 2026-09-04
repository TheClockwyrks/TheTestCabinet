import { describe, expect, it } from "vitest";
import {
  SUBSTEP_MAX,
  SHIP_X_MAX,
  SHIP_X_MIN,
  SHIP_SPEED,
  FIRE_INTERVAL,
  FLIP_LOCKOUT,
  MAX_PLAYER_BULLETS,
} from "./constants";
import { noCues } from "./audio";
import { advanceGame, subStepCount } from "./sim";
import {
  canFire,
  fireShot,
  flipShip,
  moveShip,
  placeShip,
  LANE_CENTER,
  MUZZLE_Y,
} from "./ship";
import { liveState, poseDrone, run, STEP } from "./fixtures";
import { buildWave } from "./waves";
import { seedRandom } from "./rng";

describe("the sub-step rule", () => {
  it("divides an update into whole steps of at most the ceiling", () => {
    expect(subStepCount(1 / 120)).toBe(1);
    expect(subStepCount(1 / 60)).toBe(2);
    expect(subStepCount(1)).toBe(120);
    expect(subStepCount(0)).toBe(1);
    expect(1 / 60 / subStepCount(1 / 60)).toBeCloseTo(SUBSTEP_MAX, 12);
  });

  it("reaches the same state however a second was divided into frames", () => {
    const shot = (frames: number) => {
      const state = liveState();
      seedRandom(state, 11);
      state.stage = 1;
      state.waveEntry = true;
      state.diveLaunching = true;
      buildWave(state);
      const cues = noCues();
      for (let frame = 0; frame < frames; frame += 1) {
        advanceGame(state, 1 / frames, cues);
      }
      return JSON.stringify({
        simTime: state.simTime,
        drones: state.drones.map((drone) => [
          drone.id,
          drone.x,
          drone.y,
          drone.phase,
          drone.band,
          drone.bandClock,
        ]),
        bullets: state.bullets.map((bullet) => [bullet.id, bullet.x, bullet.y]),
        rngState: state.rngState,
      });
    };
    const one = shot(1);
    expect(shot(60)).toBe(one);
    expect(shot(120)).toBe(one);
  });

  it("accumulates simulation time on every screen", () => {
    for (const screen of [
      "title",
      "howto",
      "stageIntro",
      "inWave",
      "paused",
      "stageCleared",
      "gameOver",
    ] as const) {
      const state = liveState();
      state.screen = screen;
      state.phaseTimer = 99;
      run(state, 1);
      expect(state.simTime).toBeCloseTo(1, 6);
    }
  });

  it("advances nothing on a delta of zero", () => {
    const state = liveState();
    advanceGame(state, 0, noCues());
    expect(state.simTime).toBe(0);
  });
});

describe("the ship", () => {
  it("travels at its own speed while a direction is held", () => {
    const state = liveState();
    for (let frame = 0; frame < 60; frame += 1) moveShip(state, 1, STEP);
    expect(state.ship.x - LANE_CENTER).toBeCloseTo(SHIP_SPEED, 0);
  });

  it("stops in the frame the direction is released", () => {
    const state = liveState();
    moveShip(state, -1, STEP);
    const stopped = state.ship.x;
    for (let frame = 0; frame < 6; frame += 1) moveShip(state, 0, STEP);
    expect(state.ship.x).toBe(stopped);
  });

  it("holds still when both directions are held", () => {
    const state = liveState();
    moveShip(state, 0, STEP);
    expect(state.ship.x).toBe(LANE_CENTER);
  });

  it("comes to rest at each bound rather than wrapping", () => {
    const state = liveState();
    placeShip(state, SHIP_X_MIN + 120);
    for (let frame = 0; frame < 120; frame += 1) moveShip(state, -1, STEP);
    expect(state.ship.x).toBe(SHIP_X_MIN);
    placeShip(state, SHIP_X_MAX - 120);
    for (let frame = 0; frame < 120; frame += 1) moveShip(state, 1, STEP);
    expect(state.ship.x).toBe(SHIP_X_MAX);
  });

  it("fires from its nose, carrying its band, at its cadence", () => {
    const state = liveState();
    fireShot(state, noCues());
    const bullet = state.bullets[0];
    expect(bullet.x).toBe(state.ship.x);
    expect(bullet.y).toBeCloseTo(MUZZLE_Y, 6);
    expect(bullet.band).toBe("cyan");
    expect(bullet.friendly).toBe(true);
    expect(state.ship.cooldown).toBeCloseTo(FIRE_INTERVAL, 6);
    fireShot(state, noCues());
    expect(state.bullets).toHaveLength(1);
    run(state, FIRE_INTERVAL + 0.01);
    fireShot(state, noCues());
    expect(state.bullets).toHaveLength(2);
  });

  it("caps how many of its bullets are in flight", () => {
    const state = liveState();
    for (let frame = 0; frame < 60 * 2; frame += 1) {
      fireShot(state, noCues());
      run(state, STEP);
      expect(
        state.bullets.filter((bullet) => bullet.friendly).length,
      ).toBeLessThanOrEqual(MAX_PLAYER_BULLETS);
    }
  });

  it("is blocked by the lockout a flip starts, and freed when it runs out", () => {
    const state = liveState();
    flipShip(state, noCues());
    expect(state.ship.band).toBe("magenta");
    expect(state.ship.lockout).toBeCloseTo(FLIP_LOCKOUT, 6);
    expect(canFire(state)).toBe(false);
    fireShot(state, noCues());
    expect(state.bullets).toHaveLength(0);
    run(state, FLIP_LOCKOUT + 0.02);
    expect(state.ship.lockout).toBe(0);
    fireShot(state, noCues());
    expect(state.bullets).toHaveLength(1);
  });

  it("restarts a lockout that is still standing", () => {
    const state = liveState();
    flipShip(state, noCues());
    run(state, FLIP_LOCKOUT / 2);
    flipShip(state, noCues());
    expect(state.ship.lockout).toBeCloseTo(FLIP_LOCKOUT, 6);
    expect(state.ship.band).toBe("cyan");
  });

  it("holds the lane through a second of travel", () => {
    const state = liveState();
    poseDrone(state, "shard", 100, 100);
    for (let frame = 0; frame < 60; frame += 1) {
      moveShip(state, 1, STEP);
      run(state, STEP);
    }
    expect(state.ship.x).toBeGreaterThan(LANE_CENTER);
  });
});
