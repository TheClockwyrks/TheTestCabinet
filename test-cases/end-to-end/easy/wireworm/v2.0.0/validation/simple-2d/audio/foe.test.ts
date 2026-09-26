// audio/foe — a bolt destroying a foe plays the foe cue.
//
// specs/ui.md fixes `CUES.foe` (`"foe"`) as the cue played when "a foe is
// destroyed", and governs all ten with one sentence: "Each is played on the frame
// its event happens and at most once on that frame."
//
// So the measurement is: fly one bolt into one foe, step one frame at a time, and
// read what sounded on the frame the foe left the roster against what sounded over
// the frames of the flight before it.
//
// THE FOE IS A GLITCH, WHICH ONE BOLT DESTROYS. specs/foes.md gives the glitch
// "bolts to destroy it: `1`", so the first strike is the kill and the reading is a
// roster emptying. A dropper takes two, and the first of them would put a
// non-event inside the very window this check reads quiet across.
//
// THE FOE IS FROZEN, BOTH FACULTIES OFF. specs/instrumentation.md has `travel`
// gate its locomotion and `mind` its own behavior, so with both off the glitch
// neither descends out of the bolt's column, nor darts, nor eats: it waits on the
// tile the pose put it on, and the strike is the only event in the scenario. The
// board carries nothing else, so nothing it could have eaten is there either.
//
// WHAT THIS DOES NOT DECIDE. That one bolt is what destroys a glitch is
// `foes.glitch-one-bolt`'s requirement, and that the kill pays `SCORE_GLITCH` is
// `scoring.glitch-bounty`'s. This point reads the cue alone.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, CUES, TILE } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseBolt,
  poseFoe,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { cuesBeforeEvent, cuesOnEvent, watchForEvent } from "./cues";

/**
 * The tile the glitch waits on.
 *
 * Row 10 is in the open middle of the board, clear of the entry row `0` and of the
 * player band, rows `18` and `19` (specs/board.md), so nothing but the bolt
 * reaches it.
 */
const FOE_C = 20;
const FOE_R = 10;

/** How far below the foe the bolt is posed, in tiles. */
const BOLT_DROP_TILES = 4;

/**
 * How long the bolt is given to reach the foe, in frames.
 *
 * specs/cursor.md has a bolt climb at `BOLT_SPEED` (`900` units per second) and
 * resolve when "the bolt's center is inside the foe's box, `FOE_HALF` (`12`) units
 * from the foe's center on each axis". Posed four tiles below the foe's tile, its
 * center starts `3.5` tiles, `112` units, under that tile's lower edge and so at
 * most that far under the box, which is `0.124` s of flight. Twice that is the
 * budget, so a conforming build has ample room and a build whose bolt never
 * resolves still reaches a verdict rather than running the suite out.
 */
const BOLT_FRAMES = 2 * ticksFor(((BOLT_DROP_TILES - 0.5) * TILE) / BOLT_SPEED);

/**
 * Frames of silence driven on the posed board before the bolt is put in flight.
 *
 * As long as the flight itself, so the window the check requires quiet across is
 * the same size as the window it looks for the kill in.
 */
const QUIET_LEAD = BOLT_FRAMES;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.foe on the frame the bolt destroys a foe, and not before", async () => {
  startPlaying(h);
  const foe = poseFoe(h, "glitch", FOE_C, FOE_R);
  h.debug.setFoeTravel(foe, false);
  h.debug.setFoeMind(foe, false);
  assertEqual(
    h.snapshot().foes.length,
    1,
    "posing: the board carries the one glitch the bolt is aimed at " +
      "(specs/instrumentation.md)",
  );

  const watch = await watchForEvent(
    h,
    (s) => s.foes.length === 0,
    QUIET_LEAD + BOLT_FRAMES,
    {
      quietLead: QUIET_LEAD,
      arm: () => {
        poseBolt(h, FOE_C, FOE_R + BOLT_DROP_TILES);
      },
    },
  );
  captureStill(h, "kill");

  assertEqual(
    watch.hit,
    true,
    `the bolt destroyed the glitch inside the ${String(BOLT_FRAMES)} frames ` +
      `of flight the check allows it from ${String(BOLT_DROP_TILES)} tiles ` +
      "below the foe (specs/cursor.md, specs/foes.md)",
  );
  assertEqual(
    cuesBeforeEvent(watch, CUES.foe),
    0,
    `times CUES.foe played over the ${String(watch.at - 1)} frames before the ` +
      "foe left the roster (specs/ui.md: a cue is played on the frame its " +
      "event happens)",
  );
  assertEqual(
    cuesOnEvent(watch, CUES.foe),
    1,
    "times CUES.foe played on the frame the bolt destroyed the foe, which is " +
      "its own frame and at most once on it (specs/ui.md)",
  );
});
