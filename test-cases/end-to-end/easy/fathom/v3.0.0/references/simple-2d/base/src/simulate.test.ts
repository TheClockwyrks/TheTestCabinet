// The fixed-step core, driven directly.
//
// `advanceFrame` is what makes the same interval of game time reach the same
// state however the frames that carried it were divided, and it is a pure
// function of a state and a delta, so these checks need neither an engine nor a
// canvas.

import { describe, expect, it } from "vitest";
import { BRIGHT_HOLD, SONAR_COOLDOWN, TICK_DT, TICK_HZ } from "./constants";
import { beginDive, openingState } from "./flow";
import { advanceFrame, createDrifter, tick } from "./simulate";
import type { Sheets } from "./assets";
import type { FathomState } from "./state";

const NO_ART: Sheets = {
  glimmerfin: [],
  lanternjaw: [],
  gloamfin: [],
  flarefish: [],
  drifter: [],
  flareBloom: [],
  trench: [],
};

/**
 * Live play on the opening maze, holding nothing but the forager: the board
 * grazed bare, and every predator and drifter off it, so what these checks
 * measure is the fixed step itself.
 */
function live(): FathomState {
  const dive = beginDive(openingState(NO_ART, 1, false));
  return {
    ...dive,
    screen: "playing",
    screenIn: 0,
    predators: [],
    drifters: [],
    plankton: dive.plankton.map(() => false),
    planktonRemaining: 0,
  };
}

/** The state after `seconds` of game time, delivered in frames of `step`. */
function run(state: FathomState, seconds: number, step: number): FathomState {
  let current = state;
  for (let carried = 0; carried < seconds - 1e-9; carried += step) {
    current = advanceFrame(current, step).state;
  }
  return current;
}

describe("the fixed-step core", () => {
  it("advances the whole ticks a delta completes and carries the rest", () => {
    const start = live();
    const half = advanceFrame(start, TICK_DT / 2);
    expect(half.state.simTime).toBe(0);
    expect(half.state.carry).toBeCloseTo(TICK_DT / 2, 9);

    const whole = advanceFrame(half.state, TICK_DT / 2);
    expect(whole.state.simTime).toBeCloseTo(TICK_DT, 9);
    expect(whole.state.carry).toBeCloseTo(0, 9);
  });

  it("reaches the same state however the interval was divided into frames", () => {
    const start = { ...live(), sonarCooldown: SONAR_COOLDOWN };
    const even = run(start, 1, 1 / 60);
    const coarse = run(start, 1, 1 / 15);
    const single = run(start, 1, 1);

    expect(coarse.simTime).toBeCloseTo(even.simTime, 9);
    expect(single.simTime).toBeCloseTo(even.simTime, 9);
    expect(coarse.sonarCooldown).toBeCloseTo(even.sonarCooldown, 9);
    expect(single.sonarCooldown).toBeCloseTo(even.sonarCooldown, 9);
    expect(coarse.forager).toEqual(even.forager);
    expect(single.forager).toEqual(even.forager);
  });

  it("accumulates simTime on every screen and advances nothing else on a menu", () => {
    const title = openingState(NO_ART, 1, false);
    const later = advanceFrame({ ...title, sonarCooldown: 1 }, 1).state;
    expect(later.simTime).toBeCloseTo(1, 6);
    expect(later.sonarCooldown).toBe(1);
    expect(later.forager).toEqual(title.forager);
  });

  it("takes a frame's delta at face value, whatever it is worth", () => {
    // Bounding a stalled frame is the clock's, and the engine's own wall clock
    // does it; the simulation runs exactly the ticks the delta it was handed
    // completes.
    const stalled = advanceFrame(live(), 3);
    expect(stalled.state.simTime).toBeCloseTo(3, 6);
    expect(stalled.state.carry).toBeCloseTo(0, 9);
    expect(advanceFrame(live(), -1).state.simTime).toBe(0);
  });

  it("holds the brightness for its full window, then decays it", () => {
    const start = { ...live(), brightness: 1, brightHold: BRIGHT_HOLD };
    const held = run(start, BRIGHT_HOLD - 2 * TICK_DT, TICK_DT * 4);
    expect(held.brightness).toBe(1);
    const decayed = run(held, 1, TICK_DT * 4);
    expect(decayed.brightness).toBeLessThan(1);
    expect(decayed.brightness).toBeGreaterThan(0);
  });

  it("leaves a screen with nothing to advance exactly as it was", () => {
    const title = openingState(NO_ART, 1, false);
    const stepped = tick(title, TICK_DT);
    expect(stepped.cues).toEqual([]);
    expect({ ...stepped.state, simTime: 0 }).toEqual(title);
  });

  it("puts a drifter on the center of the tile it is given", () => {
    const drifter = createDrifter(4, 5);
    expect(drifter.x).toBe(64 + 4 * 32 + 16);
    expect(drifter.y).toBe(80 + 5 * 32 + 16);
    expect(drifter.heading).toBeNull();
    expect(drifter.mind).toBe(true);
    expect(drifter.travel).toBe(true);
  });

  it("runs exactly TICK_HZ ticks over a second of game time", () => {
    const start = live();
    const second = run(start, 1, TICK_DT);
    expect(second.simTime).toBeCloseTo(TICK_HZ * TICK_DT, 9);
  });
});
