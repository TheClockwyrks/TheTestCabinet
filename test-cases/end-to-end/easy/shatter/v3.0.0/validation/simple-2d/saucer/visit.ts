// saucer — bringing one visit on with exactly the faculties a check wants.
// LOCAL TO THIS GROUP.
//
// `specs/instrumentation.md` gives the saucer THREE separable faculties — its
// mind (the weave reroll and the steering that keeps it clear of the core), its
// gun, and its locomotion — each with a gate of its own, and `addSaucer` brings
// one on with all three running. Almost every item in this group is about
// exactly one of the three, so almost every item in this group poses a saucer
// and then switches two of them off. That is four operations said in one breath,
// and this is where they are said.
//
// WHY IT IS NOT IN `../harness.ts`. The shared harness carries `poseSaucer`, the
// ATOM: one `addSaucer` and the id it appended. The faculty-by-faculty pose is
// this group's own vocabulary — no check outside `saucer` gates a saucer's mind
// or its gun — and a group's helpers live beside the checks that use them, so no
// group agent has to edit a file another group's checks stand on.
//
// NOTHING HERE IS A THRESHOLD. Where a saucer stands, how fast it is posed, and
// which faculties are on are each check's own arrangement, stated in the check;
// this file only puts the operations in order.

import { poseSaucer, theSaucer, type Harness } from "../harness";
import type { SaucerSnapshot } from "../surface";

/**
 * Which of the saucer's faculties run, and what velocity it is posed at.
 *
 * Each faculty defaults to LEFT AS `addSaucer` SET IT — which
 * `specs/instrumentation.md` fixes as on — so a check names only what it turns
 * off and a reader sees the isolation the check chose rather than a wall of
 * booleans. The velocity defaults the same way: `addSaucer` gives a saucer
 * `SAUCER_SPEED` to the right and no vertical component, and a check that wants
 * that crossing says nothing at all.
 */
export interface Faculties {
  /** Its steering decisions: the weave reroll and the core avoidance. */
  mind?: boolean;
  /** Its aimed shot every `SAUCER_FIRE_INTERVAL`. */
  gun?: boolean;
  /** Its locomotion. Off, its centre holds where it stands. */
  travel?: boolean;
  /** The velocity it is posed at, in units per second. */
  vx?: number;
  vy?: number;
}

/**
 * Bring a saucer on at `(x, y)` with exactly the faculties `options` names, and
 * answer it as the snapshot reports it.
 *
 * The velocity is posed BEFORE the gates, so a saucer posed at a velocity with
 * its travel off holds that velocity without ever having moved — which is what
 * `bullet-carries-the-saucers-velocity` reads, and what
 * `specs/instrumentation.md` gives `setSaucerVelocity` and `setSaucerTravel`
 * separately for.
 */
export function poseVisit(
  h: Harness,
  x: number,
  y: number,
  options: Faculties = {},
): SaucerSnapshot {
  poseSaucer(h, x, y);
  if (options.vx !== undefined || options.vy !== undefined) {
    h.debug.setSaucerVelocity(options.vx ?? 0, options.vy ?? 0);
  }
  if (options.mind !== undefined) h.debug.setSaucerMind(options.mind);
  if (options.gun !== undefined) h.debug.setSaucerGun(options.gun);
  if (options.travel !== undefined) h.debug.setSaucerTravel(options.travel);
  return theSaucer(
    h.snapshot(),
    "the saucer addSaucer brought onto the field (specs/instrumentation.md)",
  );
}
