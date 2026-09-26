// Every figure the game scores, and the run's one extra life.

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
import { award, droneScore, shellScore } from "./scoring";
import { bareOpeningState } from "./flow";
import { toSim } from "./sim";

describe("scoring", () => {
  it("pays a formation kill less than one off the block", () => {
    expect(droneScore("shard", "formation", 1)).toBe(SCORE_SHARD_FORM);
    expect(droneScore("flux", "formation", 1)).toBe(SCORE_FLUX_FORM);
    for (const phase of ["entering", "diving", "returning"] as const) {
      expect(droneScore("shard", phase, 1)).toBe(SCORE_SHARD_DIVE);
      expect(droneScore("flux", phase, 1)).toBe(SCORE_FLUX_DIVE);
    }
  });

  it("pays a Prism's two layers apart", () => {
    expect(shellScore(1)).toBe(SCORE_PRISM_SHELL);
    expect(droneScore("prism", "formation", 1)).toBe(SCORE_PRISM_CORE);
    expect(droneScore("prism", "diving", 1)).toBe(SCORE_PRISM_CORE);
  });

  it("pays a challenge drone its own figure, whatever it is", () => {
    for (const kind of ["shard", "flux", "prism"] as const) {
      expect(droneScore(kind, "entering", 3)).toBe(SCORE_CHALLENGE_DRONE);
    }
  });

  it("pays exactly one extra life, on the crossing and never again", () => {
    const sim = toSim(bareOpeningState());
    award(sim, EXTRA_LIFE_AT - 1);
    expect(sim.lives).toBe(START_LIVES);
    expect(sim.extraLifeAwarded).toBe(false);
    award(sim, 1);
    expect(sim.lives).toBe(START_LIVES + 1);
    expect(sim.extraLifeAwarded).toBe(true);
    award(sim, EXTRA_LIFE_AT);
    expect(sim.lives).toBe(START_LIVES + 1);
  });

  it("pays nothing for a score that never reaches the boundary", () => {
    const sim = toSim(bareOpeningState());
    award(sim, 10);
    expect(sim.score).toBe(10);
    expect(sim.lives).toBe(START_LIVES);
  });
});
