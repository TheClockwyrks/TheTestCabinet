// Every figure the game pays, and the run's one extra life.

import { describe, expect, it } from "vitest";
import {
  EXTRA_LIFE_AT,
  SCORE_CHALLENGE_DRONE,
  SCORE_FLUX_DIVE,
  SCORE_FLUX_FORM,
  SCORE_PRISM_CORE,
  SCORE_PRISM_SHELL,
  SCORE_SHARD_DIVE,
  SCORE_SHARD_FORM,
  START_LIVES,
} from "./constants";
import { emptyArt } from "./assets";
import { openingState } from "./flow";
import { addScore, killValue, shellValue } from "./scoring";
import { toSim, type MutDrone, type Sim } from "./sim";
import type { DroneKind, DronePhase } from "./game";

function bare(): Sim {
  return toSim(openingState(emptyArt()));
}

function drone(kind: DroneKind, phase: DronePhase, shell = true): MutDrone {
  return {
    id: 1,
    kind,
    x: 0,
    y: 0,
    band: "cyan",
    phase,
    phaseClock: 0,
    slotX: 0,
    slotY: 0,
    entryGroup: 0,
    bandClock: 0,
    shellAlive: shell,
    shotsFired: 0,
    travel: true,
    oscillation: true,
    fire: true,
    charge: 0,
  };
}

describe("what a destroyed drone pays", () => {
  it("pays a Shard by the phase it stood in", () => {
    const sim = bare();
    expect(killValue(sim, drone("shard", "formation"))).toBe(SCORE_SHARD_FORM);
    expect(killValue(sim, drone("shard", "diving"))).toBe(SCORE_SHARD_DIVE);
    expect(killValue(sim, drone("shard", "entering"))).toBe(SCORE_SHARD_DIVE);
    expect(killValue(sim, drone("shard", "returning"))).toBe(SCORE_SHARD_DIVE);
  });

  it("pays a Flux by the phase it stood in", () => {
    const sim = bare();
    expect(killValue(sim, drone("flux", "formation"))).toBe(SCORE_FLUX_FORM);
    expect(killValue(sim, drone("flux", "diving"))).toBe(SCORE_FLUX_DIVE);
  });

  it("pays a Prism's shell and its core", () => {
    const sim = bare();
    expect(shellValue()).toBe(SCORE_PRISM_SHELL);
    expect(killValue(sim, drone("prism", "diving", false))).toBe(
      SCORE_PRISM_CORE,
    );
    // Taken whole, it pays both layers together.
    expect(killValue(sim, drone("prism", "diving", true))).toBe(
      SCORE_PRISM_SHELL + SCORE_PRISM_CORE,
    );
  });

  it("pays a challenge drone its own figure", () => {
    const sim = bare();
    sim.stage = 3;
    expect(killValue(sim, drone("shard", "entering"))).toBe(
      SCORE_CHALLENGE_DRONE,
    );
  });
});

describe("the run's one extra life", () => {
  it("is paid as the score first reaches the threshold", () => {
    const sim = bare();
    addScore(sim, EXTRA_LIFE_AT - 1);
    expect(sim.lives).toBe(START_LIVES);
    expect(sim.extraLifeAwarded).toBe(false);
    addScore(sim, 1);
    expect(sim.lives).toBe(START_LIVES + 1);
    expect(sim.extraLifeAwarded).toBe(true);
  });

  it("is paid once, whatever the score does afterwards", () => {
    const sim = bare();
    addScore(sim, EXTRA_LIFE_AT * 3);
    expect(sim.lives).toBe(START_LIVES + 1);
    addScore(sim, EXTRA_LIFE_AT * 3);
    expect(sim.lives).toBe(START_LIVES + 1);
  });
});
