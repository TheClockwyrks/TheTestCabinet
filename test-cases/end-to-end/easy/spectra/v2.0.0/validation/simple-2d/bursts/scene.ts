// bursts/scene — the arrangement every check in this group builds on.
//
// It lives beside the checks that use it rather than in the shared harness next
// door because only the `bursts` group poses a field this way. Like everything
// there it fixes GEOMETRY and nothing else — where the drone stands, and how a
// shot reaches the drone it pops — and never a threshold: every distance,
// tolerance and bound a check asserts is stated in that check, derived from the
// figure `specs/` fixes for it.

import { assertLength, assertTrue } from "../assert";
import { PLAYER_BULLET_SPEED } from "../constants";
import {
  poseDrone,
  SHOT_GAP,
  ticksFor,
  type Band,
  type Harness,
} from "../harness";

/** What {@link firedPop} found: the burst the shot started, and when. */
export interface Pop {
  /** The id of the one burst that appeared. */
  id: number;
  /** Frames driven between the shot being placed and that burst appearing. */
  frames: number;
}

/**
 * The frames {@link firedPop} allows a shot to reach its target.
 *
 * Geometry, not a tolerance. The bullet is placed `SHOT_GAP` below the point and
 * climbs at `PLAYER_BULLET_SPEED` (`specs/ship.md`), so the contact is inside the
 * frames that speed needs to close the gap; three times that is room for the
 * target's own half-extent, for a build that resolves contact a frame late, and
 * for nothing else. A build that never lands the shot runs out here and the
 * caller reports the pop it never got, rather than sweeping on.
 */
const FLIGHT_MAX_FRAMES = 3 * ticksFor(SHOT_GAP / PLAYER_BULLET_SPEED);

/**
 * Fire one of the player's bullets carrying `band` at `(x, y)` and stop on the
 * frame a burst appeared, reporting that burst and the frames it took.
 *
 * The same shot {@link fireAt} fires — one bullet, `SHOT_GAP` below the point,
 * left to the game's own contact and band rules — driven to the POP rather than
 * for a fixed flight. Stopping there is what lets a check read a burst at an age
 * it knows: the burst is at most one frame old when this returns, so a check
 * that then drives `d` seconds is reading an age of `d` to `d` plus a frame,
 * whatever fraction of the flight the contact fell in.
 *
 * WHY THE BURST IS FOUND BY WHAT WAS NOT THERE BEFORE. `specs/instrumentation.md`
 * makes appending the rule for an entity ADDED THROUGH THE SURFACE, so an id is
 * findable without an assignment scheme — and there is no operation that adds a
 * burst. A burst is an outcome, and the surface says only that the roster is
 * reported in roster order. So the burst a pop left is identified as the live
 * burst carrying an id that was not live before it, which holds whatever order a
 * build keeps its roster in.
 *
 * Exactly one, because a pop starts one burst (`specs/assets.md`): a sweep that
 * ended on two has nothing to report an age, a size or a placement off, and says
 * so as the precondition it is rather than picking one.
 */
export async function firedPop(
  h: Harness,
  x: number,
  y: number,
  band: Band,
): Promise<Pop> {
  const had = new Set(h.snapshot().bursts.map((burst) => burst.id));
  h.debug.addPlayerBullet(x, y + SHOT_GAP, band);

  const swept = await h.until(
    (snapshot) => snapshot.bursts.some((burst) => !had.has(burst.id)),
    { maxFrames: FLIGHT_MAX_FRAMES },
  );
  assertTrue(
    swept.hit,
    `precondition: the ${band} shot fired at (${x}, ${y}) started a burst ` +
      `within ${FLIGHT_MAX_FRAMES} frames (specs/assets.md: one burst starts ` +
      `in the moment a drone is destroyed)`,
  );

  const added = swept.snapshot.bursts.filter((burst) => !had.has(burst.id));
  assertLength(
    added,
    1,
    `precondition: exactly one burst appeared on the frame the ${band} shot ` +
      `fired at (${x}, ${y}) resolved`,
  );
  return { id: added[0].id, frames: swept.frames };
}
