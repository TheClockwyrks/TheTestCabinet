// The lane, the nose a shot leaves from, and the three gates on firing.

import { describe, expect, it } from "vitest";
import {
  FIRE_INTERVAL,
  FLIP_LOCKOUT,
  MAX_PLAYER_BULLETS,
  SHIP_X_MAX,
  SHIP_X_MIN,
  SHIP_Y,
} from "./constants";
import { LANE_CENTER, canFire, clampLane, fire, flip, noseY } from "./ship";
import { bareOpeningState } from "./flow";
import { newFrameEvents, toSim } from "./sim";

describe("the ship", () => {
  it("holds its lane's bounds and rests at them", () => {
    expect(clampLane(-500)).toBe(SHIP_X_MIN);
    expect(clampLane(9000)).toBe(SHIP_X_MAX);
    expect(clampLane(700)).toBe(700);
    expect(LANE_CENTER).toBe((SHIP_X_MIN + SHIP_X_MAX) / 2);
  });

  it("fires from above its own lane position", () => {
    expect(noseY()).toBeLessThan(SHIP_Y);
  });

  it("gates a shot on the cadence, the cap and the lockout", () => {
    const sim = toSim(bareOpeningState());
    const events = newFrameEvents();
    expect(canFire(sim)).toBe(true);

    fire(sim, events);
    expect(sim.bullets).toHaveLength(1);
    expect(sim.ship.cooldown).toBeCloseTo(FIRE_INTERVAL, 9);
    expect(canFire(sim)).toBe(false);

    sim.ship.cooldown = 0;
    expect(canFire(sim)).toBe(true);
    while (sim.bullets.length < MAX_PLAYER_BULLETS) {
      fire(sim, events);
      sim.ship.cooldown = 0;
    }
    expect(canFire(sim)).toBe(false);

    sim.bullets = [];
    flip(sim, events);
    expect(sim.ship.band).toBe("magenta");
    expect(sim.ship.lockout).toBeCloseTo(FLIP_LOCKOUT, 9);
    expect(canFire(sim)).toBe(false);
    expect(events.cues.has("flip")).toBe(true);
    expect(events.cues.has("fire")).toBe(true);
  });

  it("restarts a standing lockout on a second flip", () => {
    const sim = toSim(bareOpeningState());
    const events = newFrameEvents();
    flip(sim, events);
    sim.ship.lockout = 0.05;
    flip(sim, events);
    expect(sim.ship.band).toBe("cyan");
    expect(sim.ship.lockout).toBeCloseTo(FLIP_LOCKOUT, 9);
  });
});
