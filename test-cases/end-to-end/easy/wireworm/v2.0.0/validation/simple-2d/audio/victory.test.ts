// audio/victory — winning plays the victory sting.
//
// specs/ui.md fixes `CUES.victory` (`"victory"`) as the cue played when "the
// `victory` screen opens", and governs all ten with one sentence: "Each is played
// on the frame its event happens and at most once on that frame."
//
// So the measurement is: remove the last segment of level `TOTAL_LEVELS`'s worm,
// step one frame at a time, and read what sounded on the frame the victory screen
// opened against what sounded over the frames of the bolt's flight before it.
//
// THE LEVEL IS 12, WHICH IS WHAT MAKES THIS A WIN. specs/progression.md reaches
// victory when "the last worm segment of level `12` is removed", and turns the
// same removal on any lower level into a level clear. `setLevel(TOTAL_LEVELS)`
// spawns nothing and clears nothing (specs/instrumentation.md), so it poses the
// last level without putting anything else on the board, and it is the one thing
// separating this scenario from `audio/level-clear`'s.
//
// THE WORM IS ONE SEGMENT, POSED RATHER THAN ENTERED. A level-12 worm enters at
// `wormLength(12)` (`32`) segments, and cutting thirty-two of them would put
// thirty-one removals inside the very window this check reads quiet across. One
// posed segment makes the single strike the whole win. It stands still, both
// faculties off, so it charges no node and cannot leave the bolt's column.
//
// THE CUT AND LEVEL-CLEAR CUES MAY SOUND ON THE SAME FRAME, AND THAT IS ALLOWED:
// "a frame that raises more than one of them plays each of those once"
// (specs/ui.md). Only `CUES.victory` is counted.
//
// WHAT THIS DOES NOT DECIDE. That the last level's clear wins the run is
// `progression.victory-on-twelve`'s requirement, that the victory screen shows
// what it must is `screens.victory-screen`'s, and that the win pays
// `SCORE_VICTORY` per life is `scoring.victory-bonus`'s. This point reads the cue
// alone.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, CUES, TILE, TOTAL_LEVELS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseBolt,
  poseWorm,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { cuesBeforeEvent, cuesOnEvent, watchForEvent } from "./cues";

/**
 * The tile the worm's one segment stands on.
 *
 * Row 10 is in the open middle of the board, clear of the entry row `0` and of the
 * player band, rows `18` and `19` (specs/board.md).
 */
const WORM_C = 20;
const WORM_R = 10;

/** How far below the segment the bolt is posed, in tiles. */
const BOLT_DROP_TILES = 4;

/**
 * How long the bolt is given to reach the segment, in frames.
 *
 * specs/cursor.md has a bolt climb at `BOLT_SPEED` (`900` units per second) and
 * resolve when "the bolt's center is inside the segment's tile". Posed four tiles
 * below it, its center starts `3.5` tiles, `112` units, under that tile's lower
 * edge, which is `0.124` s of flight. Twice that is the budget, so a conforming
 * build has ample room and a build whose bolt never resolves still reaches a
 * verdict rather than running the suite out.
 */
const BOLT_FRAMES = 2 * ticksFor(((BOLT_DROP_TILES - 0.5) * TILE) / BOLT_SPEED);

/**
 * Frames of silence driven on the posed board before the bolt is put in flight.
 *
 * As long as the flight itself, so the window the check requires quiet across is
 * the same size as the window it looks for the win in.
 */
const QUIET_LEAD = BOLT_FRAMES;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.victory on the frame the victory screen opens, and not before", async () => {
  startPlaying(h);
  h.debug.setLevel(TOTAL_LEVELS);
  const worm = poseWorm(h, WORM_C, WORM_R, 1, 1, 1);
  h.debug.setWormStepping(worm, false);
  h.debug.setWormBody(worm, false);

  const posed = h.snapshot();
  assertEqual(
    posed.level,
    TOTAL_LEVELS,
    "posing: the run stands on the last level, so removing the worm wins it " +
      "rather than clearing a level (specs/progression.md)",
  );
  assertEqual(
    posed.worms.length,
    1,
    "posing: the board carries the one worm whose last segment the bolt takes " +
      "(specs/instrumentation.md)",
  );

  const watch = await watchForEvent(
    h,
    (s) => s.screen === "victory",
    QUIET_LEAD + BOLT_FRAMES,
    {
      quietLead: QUIET_LEAD,
      arm: () => {
        poseBolt(h, WORM_C, WORM_R + BOLT_DROP_TILES);
      },
    },
  );
  captureStill(h, "victory");

  assertEqual(
    watch.hit,
    true,
    `the victory screen opened inside the ${String(BOLT_FRAMES)} frames of ` +
      `flight the check allows the bolt from ${String(BOLT_DROP_TILES)} tiles ` +
      "below the last segment of the level-12 worm (specs/cursor.md, " +
      "specs/progression.md)",
  );
  assertEqual(
    cuesBeforeEvent(watch, CUES.victory),
    0,
    `times CUES.victory played over the ${String(watch.at - 1)} frames before ` +
      "the victory screen opened (specs/ui.md: a cue is played on the frame " +
      "its event happens)",
  );
  assertEqual(
    cuesOnEvent(watch, CUES.victory),
    1,
    "times CUES.victory played on the frame the victory screen opened, which " +
      "is its own frame and at most once on it (specs/ui.md)",
  );
});
