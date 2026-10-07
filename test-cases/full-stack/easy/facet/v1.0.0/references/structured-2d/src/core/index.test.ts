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
      // The screens' pointer targets.
      "targetsFor",
      "targetAt",
      "menuIndexOf",
      // The ruleset.
      "maximalRuns",
      "seedFromRuns",
      "prismSeed",
      "expandClearSet",
      "applyStrain",
      "creationsFor",
      "settleAndRefill",
      "lastFall",
      "judgeSwap",
      "legalSwapExists",
      // The chain and the frame.
      "resolveStep",
      "posedRefill",
      "requestSwap",
      "tick",
      "levelTarget",
      "multiplierFor",
      "stepHold",
      "landAt",
      // The deal, the controls, the screens, the state.
      "dealOpeningBoard",
      "pressCell",
      "offerCell",
      "releaseBoard",
      "pointerDown",
      "pointerMove",
      "pointerUp",
      "startRound",
      "continueLevel",
      "createInitialState",
      // The debug logic.
      "snapshot",
      "reset",
      "loadBoard",
      "dealBoard",
      "clearBoard",
      "clearChain",
      "clearRefusal",
      "setScreen",
      "setMenuIndex",
      "setOffer",
      "clearOffer",
      "setBestChain",
      "setBestMove",
      "setMoveScore",
      "setRefillKinds",
      "clearRefillKinds",
      "poseSwap",
    ]) {
      expect(typeof core[name as keyof typeof core]).toBe("function");
    }
  });

  it("runs a whole round through the barrel alone", () => {
    const started = core.startRound(core.createInitialState());
    const shot = core.snapshot(core.tick(started, 1 / 60).state);
    expect(shot.screen).toBe("playing");
    expect(shot.board.cells).toHaveLength(64);
    expect(shot.legalSwap).toBe(true);
    expect(shot.targets.map((target) => target.id)).toEqual(["pause"]);
  });
});
