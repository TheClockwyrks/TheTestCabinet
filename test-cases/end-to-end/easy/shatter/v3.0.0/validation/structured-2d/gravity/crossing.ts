// gravity/crossing — the one shot `gravity/bullet-curves` and
// `gravity/enemy-bullet-curves` are both flown. Local to this group.
//
// The two items are deliberately the same scenario twice: the review item for the
// saucer's round reads "an enemy bullet posed on the same line as
// `bullet-curves`, bent by the same law", and `specs/gravity.md` pulls "a bullet
// the ship fired" and "a saucer bullet" with one row each and one rule between
// them. Sharing the pose is what makes the two grades comparable — a build that
// passes one and fails the other has exempted one roster from its gravity pass,
// which is exactly the fault the pair exists to name.
//
// THE LINE. `y = STAR_Y - 150`, so an unbent shot along it passes 150 units from
// the star, which is the distance the review item states. The round starts at
// `x = 380` and flies `+x` at `MUZZLE_SPEED`, crossing the star's column half a
// second in and spending the rest of the drive on the far side, where the pull it
// has already taken keeps turning into displacement.
//
// WHAT THE NO-PULL SHOT WOULD HAVE DONE, without reading it off anything. Nothing
// in `specs/` acts on a round in flight except the well and its lifetime, so a
// round with no pull holds its launch velocity exactly and reaches
// `(x0 + vx * t, y0)` — still on the line it was posed on. The bend is therefore
// read as the round's distance from that line, and it is read TOWARD THE STAR,
// which is the direction `specs/gravity.md` puts it in.
//
// WHY 1.2 SECONDS. Long enough that the specified bend, `74.1` units by
// `specs/gravity.md`'s own law integrated at `specs/simulation.md`'s timestep, is
// nearly twice the 40 the review item asks for; short enough that the round is
// still in flight under BOTH lifetimes — `BULLET_LIFE` is 1.5 seconds and
// `SAUCER_BULLET_LIFE` is 1.4 — so neither item is quietly grading a lifetime.
// The bent path's closest approach to the star is 141 units, four times the 33 at
// which `specs/collision.md` has the core absorb a round, so nothing is absorbed;
// and the round ends at `x = 1014`, inside the field, so nothing wraps and the
// bend is read on the path the round actually flew.

import { MUZZLE_SPEED, STAR_Y } from "../../src/constants";
import { ticksFor } from "../harness";

/** How far the unbent line passes from the star, in units. */
export const OFFSET = 150;

/** Where the round is posed, and the course it is posed on. */
export const CROSSING = {
  x: 380,
  y: STAR_Y - OFFSET,
  /**
   * `MUZZLE_SPEED`, the speed `specs/weapons.md` sends the ship's own round out
   * at. The saucer's round is posed at the same speed rather than its own,
   * because the second item's requirement is the FIRST item's scenario read on
   * the other roster — and `specs/gravity.md`'s law does not depend on how fast a
   * body is going, so nothing about the pull is changed by the choice.
   */
  vx: MUZZLE_SPEED,
  vy: 0,
} as const;

/** The stretch of the flight the bend is read over. */
export const FLIGHT_TICKS = ticksFor(1.2);

/**
 * How far toward the star the round must have been bent by then, in units.
 *
 * 40, the figure both review items state. `specs/gravity.md`'s law over this
 * flight gives 74.1, so a conformant build clears it by 85 percent, while a build
 * that does not pull its rounds at all reads 0.
 */
export const MIN_BEND = 40;

/**
 * Which way "toward the star" is from the line, as a sign on `y`.
 *
 * The line is posed ABOVE the star's row, so the star is at greater `y` and a
 * bend toward it is a positive displacement. Stated once, here, so neither item
 * has to reason about it at the assertion.
 */
export const TOWARD_THE_STAR = 1;
