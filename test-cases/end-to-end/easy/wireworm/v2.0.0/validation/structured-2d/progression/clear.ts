// Wireworm — progression/clear: the one arrangement four suites in this group
// share, and nothing else.
//
// Four points in this category are decided by what happens WHEN A LEVEL CLEARS —
// that the run moves past the level, that it moves past it by exactly one, that
// the next level opens on its banner, and that level `TOTAL_LEVELS` opens the
// victory screen. All four need the same thing to happen first, and
// specs/progression.md is strict about what that thing is: a level clears on the
// step in which the LAST OF ITS SEGMENTS IS REMOVED. The clear is that removal,
// so it cannot be posed — no debug operation removes a segment the way play
// removes one — and it has to be driven.
//
// So this arranges the narrowest board on which a real removal can be the last
// one: the empty, quiet board `startPlaying` poses, the level under test, one
// worm of one segment standing well above the player band with its step gated
// off so it is a target and nothing else, and one bolt in its column a tile
// below it. From there the build's own shot code carries the bolt up, the
// build's own cut rule removes the segment, and the removal is what clears the
// level.
//
// IT FIXES ARRANGEMENT AND NOTHING ELSE. Which tile the segment stands on, which
// column the bolt climbs, and how long a bolt is given to cross one tile. Every
// figure the four suites assert — the level they expect, the banner's length,
// the screen the twelfth level opens — is stated in the suite that asserts it,
// derived from what specs/progression.md fixes for it.

import { fail } from "../assert";
import {
  poseBoltAtTile,
  poseWorm,
  startPlaying,
  ticksFor,
  type Harness,
  type WirewormSnapshot,
} from "../harness";

/**
 * The tile the level's last segment stands on: mid-board horizontally, and well
 * above the player band (rows 18 and 19, specs/board.md) so nothing about the
 * cursor, its bolts' origin, or a dive's ending can bear on the removal.
 */
export const TARGET_C = 20;
export const TARGET_R = 8;

/**
 * How long the bolt is given to reach the segment, in seconds.
 *
 * It is posed one tile below the segment, so its center has at most `TILE` (32)
 * units to climb, and specs/cursor.md fixes `BOLT_SPEED` at `900` units per
 * second — about `0.036` s. `0.2` s is five times that, generous enough that a
 * build integrating the climb slightly differently still lands inside it, and
 * short enough that a build whose bolt never resolves is reported rather than
 * waited on.
 */
const CUT_WINDOW = 0.2;

/**
 * Drive a real clear of `level`, and answer the snapshot of the frame the last
 * segment left the board on.
 *
 * That frame is the one the clear happens in — specs/progression.md makes the
 * clear the removal itself — so the returned snapshot is what a caller reads its
 * level, its phase, and its screen from.
 *
 * A build whose bolt never removed the segment fails here, naming the shot the
 * scenario needed rather than the consequence the caller was going to assert.
 * That is a precondition this arrangement could not reach, not a verdict of its
 * own: `worm.shot-head-shortens` and `cursor.bolt-stops-at-segment` are the
 * points that grade the shot itself.
 */
export async function clearLastSegment(
  h: Harness,
  level: number,
): Promise<WirewormSnapshot> {
  startPlaying(h);
  h.debug.setLevel(level);
  h.debug.setReachedLevel(level);

  // Posed as a target and nothing else: with its step gated off it holds its
  // tile, so the bolt's column and the segment's column are the same column for
  // as long as the shot takes (specs/instrumentation.md, setWormStepping).
  const wormId = poseWorm(h, TARGET_C, TARGET_R);
  h.debug.setWormStepping(wormId, false);
  poseBoltAtTile(h, TARGET_C, TARGET_R + 1);

  const gone = await h.until((snapshot) => snapshot.worms.length === 0, {
    maxFrames: ticksFor(CUT_WINDOW),
  });
  if (!gone.hit) {
    fail(
      `the bolt posed one tile below the level's last segment to reach it ` +
        `within ${CUT_WINDOW} s and remove it (specs/cursor.md: a bolt ` +
        `travels up at BOLT_SPEED and destroys the first worm segment in its ` +
        `path) — the removal this point is decided by`,
      `${gone.snapshot.worms.length} worm(s) still on the board`,
    );
  }
  return gone.snapshot;
}
