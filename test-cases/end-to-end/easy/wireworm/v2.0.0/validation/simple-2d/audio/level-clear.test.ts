// audio/level-clear — clearing a level plays the level-clear cue.
//
// specs/ui.md fixes `CUES.levelClear` (`"level-clear"`) as the cue played when "a
// level clears", and governs all ten with one sentence: "Each is played on the
// frame its event happens and at most once on that frame."
//
// So the measurement is: remove the last segment of the level's worm, step one
// frame at a time, and read what sounded on the frame the level cleared against
// what sounded over the frames of the bolt's flight before it.
//
// THE FRAME THE LEVEL CLEARS IS THE FRAME THE LAST SEGMENT GOES. specs/progression
// .md says so outright: "A level clears on the step in which the last of its worm
// segments is removed. The clear is that removal." So the board emptying of worms
// is the event, read from the same snapshot the cue is attributed to, and the
// check does not have to decide separately when the build noticed.
//
// THE WORM IS ONE SEGMENT. A single strike is then the whole clear, so the frame
// the cue is read on is unambiguous, and nothing about how a longer worm shortens
// or splits enters the reading. It stands still, both faculties off, so it charges
// no node and cannot leave the bolt's column.
//
// THE LEVEL IS 1, WHICH IS NOT THE LAST. specs/progression.md pays a clear below
// `TOTAL_LEVELS` (`12`) by advancing the level, and turns the last one into a
// victory instead. Clearing level 12 is `audio/victory`'s point, and posing level 1
// is what keeps the two events apart.
//
// THE CUT CUE SOUNDS HERE TOO, AND THAT IS CORRECT. The bolt destroys a segment on
// the same frame, and specs/ui.md allows it: "a frame that raises more than one of
// them plays each of those once." Only `CUES.levelClear` is counted.
//
// WHAT THIS DOES NOT DECIDE. That the clear advances the level is
// `progression.level-advances`'s requirement, and that it pays
// `SCORE_LEVEL_CLEAR` is `scoring.level-clear-bonus`'s. This point reads the cue
// alone.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, CUES, TILE, TOTAL_LEVELS } from "../../src/constants";
import { assertEqual, assertLessThan } from "../assert";
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
 * the same size as the window it looks for the clear in.
 */
const QUIET_LEAD = BOLT_FRAMES;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.levelClear on the frame the last segment is removed, and not before", async () => {
  startPlaying(h);
  const worm = poseWorm(h, WORM_C, WORM_R, 1, 1, 1);
  h.debug.setWormStepping(worm, false);
  h.debug.setWormBody(worm, false);

  const posed = h.snapshot();
  assertEqual(
    posed.worms.length,
    1,
    "posing: the board carries the one worm whose last segment the bolt takes " +
      "(specs/instrumentation.md)",
  );
  assertLessThan(
    posed.level,
    TOTAL_LEVELS,
    "posing: the level being cleared is not the last, so the clear advances " +
      "the run rather than winning it (specs/progression.md)",
  );

  const watch = await watchForEvent(
    h,
    (s) => s.worms.length === 0,
    QUIET_LEAD + BOLT_FRAMES,
    {
      quietLead: QUIET_LEAD,
      arm: () => {
        poseBolt(h, WORM_C, WORM_R + BOLT_DROP_TILES);
      },
    },
  );
  captureStill(h, "clear");

  assertEqual(
    watch.hit,
    true,
    `the bolt removed the last segment inside the ${String(BOLT_FRAMES)} ` +
      `frames of flight the check allows it from ${String(BOLT_DROP_TILES)} ` +
      "tiles below it (specs/cursor.md)",
  );
  assertEqual(
    cuesBeforeEvent(watch, CUES.levelClear),
    0,
    `times CUES.levelClear played over the ${String(watch.at - 1)} frames ` +
      "before the last segment was removed (specs/ui.md: a cue is played on " +
      "the frame its event happens)",
  );
  assertEqual(
    cuesOnEvent(watch, CUES.levelClear),
    1,
    "times CUES.levelClear played on the frame the level cleared, which " +
      "specs/progression.md makes the frame the last segment was removed, and " +
      "at most once on it (specs/ui.md)",
  );
});
