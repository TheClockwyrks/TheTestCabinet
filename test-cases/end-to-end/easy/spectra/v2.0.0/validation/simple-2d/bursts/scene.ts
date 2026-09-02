// bursts/scene — the two arrangements every check in this group builds on.
//
// They live beside the checks that use them rather than in the shared harness
// next door because only the `bursts` group poses a field this way. Like
// everything there they fix GEOMETRY and nothing else — where an inert drone
// stands, and how a shot reaches the drone it pops — and never a threshold:
// every distance, tolerance and bound a check asserts is stated in that check,
// derived from the figure `specs/` fixes for it.

import { assertLength, assertTrue } from "../assert";
import {
  PLAYER_BULLET_SPEED,
  FIELD_LEFT,
  FIELD_TOP,
} from "../constants";
import {
  poseDrone,
  SHOT_GAP,
  ticksFor,
  type Band,
  type Harness,
} from "../harness";

/**
 * Where {@link poseBystander} stands: inside the play field, in the corner
 * furthest from the ship's lane, from the formation grid at its full sway, and
 * from every place this group poses a drone it is about to destroy.
 */
export const BYSTANDER_AT = { x: FIELD_LEFT + 40, y: FIELD_TOP + 40 } as const;

/**
 * Pose one inert Shard out of the way, so the live wave still holds a drone.
 *
 * WHAT IT IS FOR, AND WHY THIS GROUP NEEDS IT WHERE OTHERS DO NOT. A stage
 * clears in the moment the last drone of its wave is destroyed, and only a wave
 * that has had a drone removed can clear (`specs/stages.md`). Almost every
 * scenario in this suite poses a field and never destroys the last thing on it,
 * so `startPosed`'s empty field is exactly right for it. Every check in THIS
 * group destroys drones for a living — that is what starts a burst — so the
 * scenario that pops the only drone it posed leaves an empty wave that has had
 * one removed, and a conformant build opens the stage-cleared interstitial
 * underneath the reading. That is the build behaving correctly and it is simply
 * not what a check about a burst is asking about: the picture a still would keep
 * becomes the interstitial, and the frames a check drives afterwards are the
 * interstitial's rather than the wave's.
 *
 * A bystander leaves a drone standing, so the wave carries on whichever reading
 * the build took of "its wave" and the scenario under test runs to its end.
 *
 * It is a prop like any other {@link poseDrone} — every faculty off, in phase
 * `formation`, which is also the phase a discharge wave spares
 * (`specs/resonance.md`) — so it holds its corner and takes no part. A check
 * that poses one accounts for it when it counts drones.
 */
export function poseBystander(h: Harness): number {
  return poseDrone(h, "shard", BYSTANDER_AT.x, BYSTANDER_AT.y, {
    phase: "formation",
  });
}

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
