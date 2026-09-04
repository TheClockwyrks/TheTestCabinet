// progression/run — the three compound moves this group's points are built out
// of: opening a run, costing it a life, and cutting away the last segment of a
// level. CASE-PROVIDED.
//
// Each is a sequence of atomic operations, in the shape
// `guides/authoring/writing-debug-apis-and-validators.md` asks for: the surface
// poses one field at a time, and the sequence that turns those poses into "a run
// was opened" or "a life was lost" belongs to the validator side. They live here
// rather than in the shared harness because they are this group's own subject —
// nothing outside `progression/` needs to lose a life on purpose — and because
// each of them is a rule `specs/progression.md` states, which every other group
// takes for granted.
//
// NOT ONE THRESHOLD IS DECIDED IN THIS FILE. Every one of them arranges a board
// and hands the verdict back to the point that called it.

import { BAND_CX, BAND_CY, colAt, rowAt } from "../constants";
import {
  poseWorm,
  shootTile,
  type Harness,
  type Tile,
  type UntilResult,
  type WirewormDebugApi,
} from "../harness";

/**
 * Open a run the way a player does — `DESCEND` confirmed on the title — with
 * `pose` run over the title's state first.
 *
 * THE POSE IS WHAT MAKES THE READING MEAN ANYTHING. `reset` already leaves the
 * title carrying three lives, level `1` and a score of `0`
 * (`specs/instrumentation.md`), so a run opened straight off a reset reports
 * those figures whether or not the build's own run-opening sets a single one of
 * them: the point would be grading `reset`. Posing a stale figure between the
 * reset and the confirm — one life, level `9`, a score in the thousands — is the
 * position a title screen genuinely stands in after a run has ended, and it
 * makes every wrong model read as a different number: a build that opens a run
 * without laying its starting figures answers with the stale one.
 *
 * This is the shared harness's `startRunFromTitle` with that one step in the
 * middle. It is not a widening of that helper because no other group poses the
 * title it opens from.
 */
export async function openRunFrom(
  h: Harness,
  pose: (debug: WirewormDebugApi) => Promise<void>,
): Promise<void> {
  await h.debug.reset();
  await pose(h.debug);
  // `DESCEND` is the first of `TITLE_ITEMS`, and confirm takes the highlighted
  // item (`specs/ui.md`).
  await h.debug.setMenuIndex(0);
  await h.tap("Enter");
  await h.advance(1);
}

/**
 * The tile a worm segment stands on to reach a cursor parked at the band's
 * center.
 *
 * `specs/cursor.md` makes contact an overlap: the cursor's box is `CURSOR_HALF`
 * (`12`) units from its center on each axis, and "a worm segment reaches the
 * cursor when the segment's tile overlaps the cursor's box". The band's center
 * `(640, 688)` sits on the top-left corner of this tile, so the tile covers the
 * lower-right quarter of that box.
 */
export const CONTACT_TILE: Tile = { c: colAt(BAND_CX), r: rowAt(BAND_CY) };

/**
 * Put one worm segment inside the cursor's box, open the cursor's contact test,
 * and run the one frame that reads it.
 *
 * The segment is a worm of ONE segment with its step faculty off: the point of
 * every scenario here is what the contact costs, not how a worm walks into one,
 * and a worm that cannot step cannot walk back out of the box between the pose
 * and the reading. Nothing else is on the board unless the caller put it there.
 *
 * `setCursorContact(true)` is the gate this group is allowed to open, because
 * the contact is the event every one of these points is about; it is shut by
 * `startPlaying` and opened here at the last moment, so nothing the caller posed
 * before it could have cost a life early.
 */
export async function contactCursor(
  h: Harness,
  tile: Tile = CONTACT_TILE,
): Promise<void> {
  await poseWorm(h, { c: tile.c, r: tile.r, length: 1, stepping: false });
  await h.debug.setCursorContact(true);
  await h.advance(1);
}

/**
 * The tile the level's last segment is posed on: clear of the entry row, of the
 * player band, and of everything else a scenario here puts on the board.
 */
export const LAST_SEGMENT: Tile = { c: 12, r: 8 };

/**
 * Pose the level's whole worm as a single segment and shoot it away.
 *
 * `specs/progression.md` clears a level "on the step in which the last of its
 * worm segments is removed", and `specs/worm.md` gives a worm of one segment as
 * "a head alone" — so a one-segment worm is the shortest board on which that
 * step exists at all, and the bolt that removes it is the removal the rule turns
 * on. The bolt is a real one: `addBolt` puts it in flight and "it then travels
 * and resolves through the game's own shot rules"
 * (`specs/instrumentation.md`), so the build's own shot code is what removes the
 * segment.
 *
 * The segment's step faculty is off for the same reason as above — where the
 * worm would have wound to is no part of any point here — and the tile below it
 * carries nothing, so the bolt resolves against the segment and against nothing
 * else.
 */
export async function cutLastSegment(h: Harness): Promise<UntilResult> {
  await poseWorm(h, {
    c: LAST_SEGMENT.c,
    r: LAST_SEGMENT.r,
    length: 1,
    stepping: false,
  });
  return shootTile(h, LAST_SEGMENT.c, LAST_SEGMENT.r);
}
