// The ship, its lane, and the three gates on its cannon.

import { describe, expect, it } from "vitest";
import {
  FIRE_INTERVAL,
  FLIP_LOCKOUT,
  MAX_PLAYER_BULLETS,
  PLAYER_BULLET_SPEED,
  SHIP_X_MAX,
  SHIP_X_MIN,
  SHIP_Y,
} from "./constants";
import { LANE_CENTER, canFire, clampLane, fire, flip, noseY } from "./ship";
import { newFrameEvents } from "./events";
import { liveWave, poseEnemyBullet, posePlayerBullet } from "./fixtures";

describe("the ship's lane", () => {
  it("clamps to the lane's bounds and never wraps", () => {
    expect(clampLane(SHIP_X_MIN - 400)).toBe(SHIP_X_MIN);
    expect(clampLane(SHIP_X_MAX + 400)).toBe(SHIP_X_MAX);
    expect(clampLane(700)).toBe(700);
  });

  it("rests at the centre of its lane", () => {
    expect(LANE_CENTER).toBe((SHIP_X_MIN + SHIP_X_MAX) / 2);
  });
});

describe("the cannon", () => {
  it("puts a shot on the ship's own centre, above the lane, carrying its band", () => {
    const state = liveWave();
    state.ship.x = 512;
    state.ship.band = "magenta";
    fire(state, newFrameEvents());

    const bullet = state.bullets[0];
    expect(bullet).toBeDefined();
    expect(bullet?.x).toBe(512);
    expect(bullet?.y).toBeLessThan(SHIP_Y);
    expect(bullet?.y).toBe(noseY());
    expect(bullet?.vy).toBe(-PLAYER_BULLET_SPEED);
    expect(bullet?.band).toBe("magenta");
    expect(bullet?.friendly).toBe(true);
  });

  it("sets the cadence and plays the cue", () => {
    const state = liveWave();
    const events = newFrameEvents();
    fire(state, events);
    expect(state.ship.cooldown).toBe(FIRE_INTERVAL);
    expect([...events.cues]).toContain("fire");
  });

  it("is blocked by the cadence, the cap and the lockout, and by nothing else", () => {
    const state = liveWave();
    expect(canFire(state)).toBe(true);

    state.ship.cooldown = 0.01;
    expect(canFire(state)).toBe(false);
    state.ship.cooldown = 0;

    state.ship.lockout = 0.01;
    expect(canFire(state)).toBe(false);
    state.ship.lockout = 0;

    for (let i = 0; i < MAX_PLAYER_BULLETS; i++) {
      posePlayerBullet(state, 100 + i, 300, "cyan");
    }
    expect(canFire(state)).toBe(false);
    state.bullets = [];
    expect(canFire(state)).toBe(true);
  });

  it("counts only the player's bullets against the cap", () => {
    const state = liveWave();
    for (let i = 0; i < MAX_PLAYER_BULLETS + 3; i++) {
      poseEnemyBullet(state, 100 + i, 300, "cyan");
    }
    expect(canFire(state)).toBe(true);
  });
});

describe("the flip", () => {
  it("holds the other band in the frame the action is delivered", () => {
    const state = liveWave();
    const events = newFrameEvents();
    flip(state, events);
    expect(state.ship.band).toBe("magenta");
    expect(state.ship.lockout).toBe(FLIP_LOCKOUT);
    expect([...events.cues]).toContain("flip");
  });

  it("restarts a lockout that is still standing", () => {
    const state = liveWave();
    state.ship.lockout = 0.05;
    flip(state, newFrameEvents());
    expect(state.ship.lockout).toBe(FLIP_LOCKOUT);
  });

  it("leaves a bullet already in flight on the band it was fired with", () => {
    const state = liveWave();
    fire(state, newFrameEvents());
    flip(state, newFrameEvents());
    expect(state.bullets[0]?.band).toBe("cyan");
    expect(state.ship.band).toBe("magenta");
  });
});
