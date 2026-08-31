// The barrel: what a build reaches for when it imports the core.

import { describe, expect, it } from "vitest";
import * as core from "./index";

describe("the core's surface", () => {
  it("re-exports the whole of the core from one module", () => {
    for (const name of [
      // The board and its notation.
      "cellX",
      "cellY",
      "parseBoard",
      "formatBoard",
      "targetCell",
      // The ruleset.
      "maximalRuns",
      "seedFromRuns",
      "prismSeed",
      "expandClearSet",
      "applyStrain",
      "creationsFor",
      "settleAndRefill",
      "judgeSwap",
      "legalSwapExists",
      // The chain and the frame.
      "resolveStep",
      "requestSwap",
      "tick",
      "levelTarget",
      "multiplierFor",
      // The deal, the controls, the screens, the state, the generator.
      "dealOpeningBoard",
      "actOnCell",
      "pointerDown",
      "startRound",
      "createInitialState",
      "nextRandom",
      // The debug logic.
      "snapshot",
      "reset",
      "loadBoard",
      "poseSwap",
    ]) {
      expect(typeof core[name as keyof typeof core]).toBe("function");
    }
  });

  it("runs a whole round through the barrel alone", () => {
    const started = core.startRound(core.createInitialState(3));
    const shot = core.snapshot(core.tick(started, 1 / 60).state);
    expect(shot.screen).toBe("playing");
    expect(shot.board.cells).toHaveLength(64);
    expect(shot.legalSwap).toBe(true);
  });
});
