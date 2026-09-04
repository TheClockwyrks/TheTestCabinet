// gravity/well — the two arrangements every reading of the LAW itself is taken
// through. Local to this group.
//
// `specs/gravity.md` states the well as an ACCELERATION — `MU / dEff^2` toward
// the star's centre, added to a pulled body's velocity every tick — and
// `specs/simulation.md` fixes where in a tick that happens: step 2, before the
// velocity is integrated in step 3 and the position in step 4. So the honest
// reading of the law is the velocity a body AT REST gains over exactly ONE tick,
// and that is what these two functions arrange.
//
// WHY AT REST, AND WHY ONE TICK. Three confounds disappear at once.
//
//   - A body at rest does not move within the tick, so the distance the pull was
//     computed at is the distance the check posed, whatever order a build applies
//     its steps in. A moving body's reading would depend on whether the build
//     sampled the well before or after the position advanced, which
//     `specs/simulation.md` fixes but which a tolerance would otherwise have to
//     absorb.
//   - One tick is one application of the law, so the reading is the acceleration
//     itself rather than a path — no integrator, no accumulated error, and no
//     room for two builds that both obey the law to disagree.
//   - A body at rest gains NOTHING but the pull, so the whole velocity read back
//     is the well's contribution and there is nothing to subtract.
//
// The three checks that read the law — `pull-magnitude`, `pull-direction` and
// `softening-cap` — all read it this way, and each asserts a different property
// of the SAME reading, so a build that fails one names which half of the law it
// got wrong. `direct-not-wrapped` poses a rock rather than a round, because its
// requirement is about a body near a corner rather than about a round, so it
// arranges its own body and uses only {@link aroundTheStar}.
//
// Nothing here holds a threshold. Every figure a check asserts is stated in the
// check itself, derived from `specs/gravity.md`.

import { assertLessThanOrEqual } from "../assert";
import type { Vec } from "../geometry";
import { STAR } from "../geometry";
import {
  poseBullet,
  requireBullet,
  type Harness,
  type ShatterSnapshot,
} from "../harness";

/**
 * How far a posed round's centre may sit from where it was asked to go, in
 * units, read back before any frame runs.
 *
 * Half a unit. `specs/instrumentation.md` places `addBullet`'s round "its centre
 * at a logical field position" and, under this engine, a pose "acts on the live
 * game the moment it is called" — so nothing has moved it yet and a conformant
 * build reads back the number it was handed. This is not a check on `addBullet`,
 * which is `instrumentation/add-bullet`'s item: it is the precondition the
 * readings rest on, so a build that placed its round somewhere else fails naming
 * THAT rather than showing up as a pull of the wrong size at a distance nobody
 * posed.
 */
const POSE_TOLERANCE = 0.5;

/**
 * The point exactly `distance` units from the star's centre along `bearing`.
 *
 * Bearings are measured the way `specs/overview.md` measures every angle in this
 * game: clockwise from `+x`, with `y` running down the field. The star stands at
 * the field's centre (`specs/field.md`), so every distance this group poses puts
 * the point well inside the field and the direct separation to the star is the
 * plain difference.
 */
export function aroundTheStar(distance: number, bearing: number): Vec {
  return {
    x: STAR.x + distance * Math.cos(bearing),
    y: STAR.y + distance * Math.sin(bearing),
  };
}

/**
 * One of the ship's rounds posed AT REST at each point, one tick run, and the
 * velocity each of them gained over it.
 *
 * The rounds are posed together and read after a single shared tick, so the
 * whole set is one arrangement and one drive: the still every check that uses
 * this declares is the frame that tick left, showing every body the reading was
 * taken from.
 *
 * They do not interact. `specs/collision.md` gives no pair for two of the ship's
 * bullets, so each of them is alone in the well as far as the law is concerned,
 * and each is read on its own id — hard-asserted through `requireBullet`, so a
 * build whose `addBullet` placed nothing fails naming the operation rather than
 * crashing the suite.
 */
export async function gainsAtRest(
  h: Harness,
  at: readonly Vec[],
): Promise<{ vx: number; vy: number }[]> {
  const ids = at.map((point) => poseBullet(h, point.x, point.y, 0, 0));

  const posed: ShatterSnapshot = h.snapshot();
  for (let i = 0; i < ids.length; i += 1) {
    const round = requireBullet(
      posed,
      ids[i],
      `addBullet(${at[i].x.toFixed(2)}, ${at[i].y.toFixed(2)}, 0, 0) to place ` +
        "a round at rest (specs/instrumentation.md)",
    );
    // The pose landed where it was asked to. A round the surface put somewhere
    // else would be read at a distance the check never posed, so it is caught
    // here rather than showing up as a pull of the wrong size.
    assertLessThanOrEqual(
      Math.hypot(round.x - at[i].x, round.y - at[i].y),
      POSE_TOLERANCE,
      `how far the round addBullet placed sits from the ` +
        `(${at[i].x.toFixed(2)}, ${at[i].y.toFixed(2)}) it was given, in ` +
        "units, before any frame ran (specs/instrumentation.md)",
    );
  }

  await h.advance(1);

  const after = h.snapshot();
  return ids.map((id, i) => {
    const bullet = requireBullet(
      after,
      id,
      `the round posed at rest ${at[i].x.toFixed(2)}, ${at[i].y.toFixed(2)} ` +
        "still in flight one tick later",
    );
    return { vx: bullet.vx, vy: bullet.vy };
  });
}
