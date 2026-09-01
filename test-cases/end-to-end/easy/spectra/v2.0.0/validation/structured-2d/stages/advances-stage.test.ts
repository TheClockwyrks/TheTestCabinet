// stages/advances-stage — the stage number is one higher after the interstitial.
//
// specs/stages.md, The sequence: "A cleared stage opens the stage-cleared
// interstitial. When that gives way, the stage number is one higher and the next
// stage's intro opens." specs/ui.md fixes the interstitial's length at
// `STAGE_CLEARED_HOLD` (2.6 s). This point grades the NUMBER alone;
// `stages/stage-cleared-screen` grades that clearing opens the interstitial, and
// the screens group grades the hold and what it opens.
//
// WHY THE INTERSTITIAL IS POSED RATHER THAN EARNED. The requirement starts where
// the interstitial is already running, and everything before that — the wave, the
// shot, the clear — belongs to the two points above. Posing the screen with its
// full hold in front of it and letting the build's own hold run out reaches this
// requirement directly and touches nothing else: no drone is on the field, no
// bullet is in flight, and nothing but the clock decides the outcome.
//
// WHY STAGE FOUR. Every wrong model reads as a different number from it. A build
// that advances correctly reports 5; one that never advances reports 4; one that
// restarts the run reports 1; one that advances by two reports 6; one that doubles
// reports 8. Posing stage 1 would have made the first two of those the only
// distinguishable answers. Four is also a standard stage and so is five, so
// nothing about the challenge schedule is in play.

import { afterEach, beforeEach, it } from "vitest";
import { STAGE_CLEARED_HOLD } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  ticksFor,
  type Harness,
} from "../harness";

/** The stage the cleared interstitial is posed on. */
const CLEARED_STAGE = 4;

/** The stage its interstitial giving way must open. */
const NEXT_STAGE = CLEARED_STAGE + 1;

/**
 * Frames the interstitial is given to give way.
 *
 * The hold `specs/ui.md` fixes, plus a tenth of it. The slack covers only where
 * inside a frame a build decides the hold ran out; it is far too small for a build
 * running any other hold to slip through, and the assertion below is about the
 * NUMBER rather than about when it changed, so nothing of the verdict rests here.
 */
const HOLD_FRAMES = ticksFor(STAGE_CLEARED_HOLD * 1.1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("advances the stage by one when the cleared interstitial gives way", async () => {
  h.debug.setStage(CLEARED_STAGE);
  h.debug.setScreen("stageCleared");
  h.debug.setPhase("live");
  h.debug.setPhaseTimer(STAGE_CLEARED_HOLD);

  const posed = h.snapshot();
  assertEqual(
    posed.stage,
    CLEARED_STAGE,
    "the stage the interstitial was posed on (specs/instrumentation.md)",
  );

  await h.advance(HOLD_FRAMES);
  captureStill(h, "advanced");

  const after = h.snapshot();
  assertEqual(
    after.stage,
    NEXT_STAGE,
    "the stage number once the cleared interstitial has given way (specs/stages.md)",
  );
});
