// audio/cut — a bolt destroying a worm segment plays the cut cue.
//
// specs/ui.md fixes `CUES.cut` (`"cut"`) as the cue played when "a bolt destroys a
// worm segment", and governs all ten with one sentence: "Each is played on the
// frame its event happens and at most once on that frame."
//
// So the measurement is: fly one bolt into one segment, step one frame at a time,
// and read what sounded on the frame the segment left the board against what
// sounded over the frames of the flight before it. The lead is as long as the
// flight, so the quiet the check reads across is a window the size of the one the
// strike is looked for in.
//
// THE WORM IS THREE SEGMENTS AND THE BOLT TAKES ITS TAIL. Three, because a level
// clears on the step in which the LAST of its segments is removed
// (specs/progression.md), and the level-clear cue landing in the same reading is
// exactly what `audio/level-clear` is for. The tail, because an end hit shortens
// the worm and leaves one worm on the board (specs/worm.md), so the reading is a
// segment count falling by one and nothing else.
//
// THE WORM STANDS STILL. Both faculties are off, so specs/instrumentation.md
// leaves it taking no step and following nothing: it charges no node, is blocked
// by nothing, and cannot wander out of the bolt's column. The strike is the only
// event in the scenario.
//
// WHAT THIS DOES NOT DECIDE. That the strike shortens the worm from the tail is
// `worm.shot-tail-shortens`'s requirement, that it leaves a fresh inert node is
// `nodes.shot-leaves-node`'s, and that it pays `SCORE_BODY` is
// `scoring.body-segment`'s. This point reads the cue alone.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, CUES, TILE } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseBolt,
  poseWorm,
  startPlaying,
  ticksFor,
  type Harness,
  type WirewormSnapshot,
} from "../harness";
import { cuesBeforeEvent, cuesOnEvent, watchForEvent } from "./cues";

/**
 * The row the worm is laid along, and the column its head stands in.
 *
 * Row 10 is in the open middle of the board: clear of the entry row `0` and of the
 * player band, rows `18` and `19` (specs/board.md), so nothing but the bolt
 * reaches the worm.
 */
const WORM_R = 10;
const HEAD_C = 20;

/** How many segments the worm carries, and which of them the bolt is aimed at. */
const WORM_LENGTH = 3;
const TAIL_C = HEAD_C - (WORM_LENGTH - 1);

/** How far below the struck segment the bolt is posed, in tiles. */
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
 * the same size as the window it looks for the strike in, and a build sounding the
 * cue at any rate at all is as likely to be caught before the strike as on it.
 */
const QUIET_LEAD = BOLT_FRAMES;

/** Every segment standing on the board, across every worm on it. */
function segmentCount(snapshot: WirewormSnapshot): number {
  return snapshot.worms.reduce(
    (total, worm) => total + worm.segments.length,
    0,
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.cut on the frame the bolt destroys a segment, and not before", async () => {
  startPlaying(h);
  const worm = poseWorm(h, HEAD_C, WORM_R, WORM_LENGTH, 1, 1);
  h.debug.setWormStepping(worm, false);
  h.debug.setWormBody(worm, false);
  assertEqual(
    segmentCount(h.snapshot()),
    WORM_LENGTH,
    "posing: the board carries one worm of three segments and nothing else " +
      "(specs/instrumentation.md)",
  );

  const watch = await watchForEvent(
    h,
    (s) => segmentCount(s) < WORM_LENGTH,
    QUIET_LEAD + BOLT_FRAMES,
    {
      quietLead: QUIET_LEAD,
      arm: () => {
        poseBolt(h, TAIL_C, WORM_R + BOLT_DROP_TILES);
      },
    },
  );
  captureStill(h, "cut");

  assertEqual(
    watch.hit,
    true,
    `the bolt destroyed a segment inside the ${String(BOLT_FRAMES)} frames of ` +
      `flight the check allows it from ${String(BOLT_DROP_TILES)} tiles below ` +
      "the tail (specs/cursor.md)",
  );
  assertEqual(
    cuesBeforeEvent(watch, CUES.cut),
    0,
    `times CUES.cut played over the ${String(watch.at - 1)} frames before the ` +
      "segment was destroyed (specs/ui.md: a cue is played on the frame its " +
      "event happens)",
  );
  assertEqual(
    cuesOnEvent(watch, CUES.cut),
    1,
    "times CUES.cut played on the frame the bolt destroyed the segment, " +
      "which is its own frame and at most once on it (specs/ui.md)",
  );
});
