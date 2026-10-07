// stages/wave-built-at-intro — the wave comes into being as the intro gives way.
//
// specs/stages.md, The sequence: "The wave for a stage is built in the moment the
// stage-intro hold gives way to the live wave. The field is empty for that hold:
// no drone stands on it and no bullet of either side is in flight, so a stage
// always opens on a clear field." specs/ui.md fixes the hold at
// `STAGE_INTRO_HOLD` (2.0 s), and specs/swarm.md states that from that moment "the
// drone roster holds every drone of the wave".
//
// WHAT IS DRIVEN. A game posed onto the stage-1 intro with its full hold in front
// of it, and then run. Nothing is posed on the field, because the field being
// empty is half of what is under test; the wave that appears is the one the
// build's own code builds.
//
// THE TWO DIRECTIONS ARE ONE REQUIREMENT HERE. The rule fixes a MOMENT, and a
// moment is only observable as a change: a check that asserted only the empty hold
// would pass a build that never builds a wave at all, and one that asserted only
// the standing wave would pass a build that puts its drones out at the title. So
// the sweep watches the hold for a drone that should not be there and stops on the
// frame the hold gives way, where the wave should be.
//
// THE SWEEP IS BOUNDED BY THE BUILD'S OWN HOLD RATHER THAN BY THE STATED ONE. How
// long the interstitial lasts is the screens group's point, not this one, so the
// roster is read for exactly as long as the build stays on `stageIntro`: a build
// running a short hold is graded here on what its field held, and answers for the
// hold's length where that is asked.

import { afterEach, beforeEach, it } from "vitest";
import { STAGE_INTRO_HOLD } from "../constants";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  ticksFor,
  type Harness,
} from "../harness";

/** The stage whose intro is posed. Stage 1 is a standard wave. */
const STAGE = 1;

/**
 * Frames the intro is given to give way.
 *
 * Half again the hold `specs/ui.md` states, so a build running the stated hold —
 * or anything up to fifty per cent longer than it — reaches its own end inside the
 * sweep, and one that never leaves the intro is reported as such rather than
 * hanging. It is not a bound on the hold: the length of the hold is the screens
 * group's point.
 */
const SWEEP_FRAMES = ticksFor(STAGE_INTRO_HOLD * 1.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("builds no drone during the stage intro and the wave as it gives way", async () => {
  h.debug.setStage(STAGE);
  h.debug.setScreen("stageIntro");
  h.debug.setPhase("live");
  h.debug.setPhaseTimer(STAGE_INTRO_HOLD);

  // The most drones ever on the field while the intro was still up.
  let duringHold = 0;
  const gaveWay = await h.until(
    (snapshot) => {
      if (snapshot.screen !== "stageIntro") return true;
      duringHold = Math.max(duringHold, snapshot.drones.length);
      return false;
    },
    { maxFrames: SWEEP_FRAMES, poll: 1 },
  );
  captureStill(h, "built");

  assertEqual(
    duringHold,
    0,
    "the drones standing on the field at any point during the stage-intro hold (specs/stages.md)",
  );
  assertTrue(
    gaveWay.hit,
    "the stage intro to give way to the live wave (specs/stages.md, specs/ui.md)",
  );
  assertEqual(
    gaveWay.snapshot.screen,
    "inWave",
    "the live wave the stage intro gives way to (specs/stages.md)",
  );
  assertGreaterThan(
    gaveWay.snapshot.drones.length,
    0,
    "the drones of the wave the stage built in the moment its intro gave way (specs/stages.md, specs/swarm.md)",
  );
});
