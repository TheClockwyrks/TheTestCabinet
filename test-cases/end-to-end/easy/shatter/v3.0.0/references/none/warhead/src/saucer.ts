// Shatter — the enemy saucer: when it arrives, how it travels, how it shoots, and
// when it leaves.
//
// `specs/saucer.md` fixes all four. What shapes this file is that the saucer has
// THREE SEPARABLE FACULTIES, each with a gate of its own on the debug surface
// (`specs/instrumentation.md`), and each gate names exactly one of the functions
// below:
//
//   * `mind` — its steering DECISIONS: the weave it rerolls every interval, and
//     the steering that keeps it clear of the star's core. Off, nothing it
//     decides changes its velocity.
//   * `gun` — its aimed shot. Off, it fires nothing.
//   * `travel` — its locomotion. Off, its centre holds where it stands, while its
//     mind and its gun run on.
//
// Its lifetime is not a faculty and has no gate: a saucer leaves twelve seconds
// after it enters whatever else is switched off.

import {
  CUES,
  SAUCER_AIM_ERROR,
  SAUCER_AVOID_DIST,
  SAUCER_BULLET_SPEED,
  SAUCER_FIRE_INTERVAL,
  SAUCER_GAP_MAX,
  SAUCER_GAP_MIN,
  SAUCER_LIFETIME,
  SAUCER_R,
  SAUCER_WEAVE_INTERVAL,
  SAUCER_WEAVE_SPEED,
  STAR_X,
  STAR_Y,
  TICK_DT,
} from "./constants";
import { enterSaucer, makeEnemyBullet } from "./entities";
import { shortestDelta } from "./geometry";
import { slideOffCore, travel } from "./motion";
import { range } from "./rng";
import type { ShatterState } from "./types";
import { raise } from "./world";

/**
 * How much harder the saucer steers away from the core than it weaves.
 *
 * A build's own figure, like `SAUCER_AVOID_DIST`: the specification fixes the
 * outcome — the saucer's circle never overlaps the core — and leaves how it
 * steers to get there entirely open.
 */
const AVOID_SPEED_SCALE = 1.5;

/**
 * The saucer's steering decisions for this tick, which is the whole of what its
 * `mind` gates.
 *
 * Two decisions, in this order. The weave rerolls every
 * `SAUCER_WEAVE_INTERVAL`, setting the vertical velocity to
 * `SAUCER_WEAVE_SPEED` directed OPPOSITE the way it is currently travelling, so
 * its vertical direction reverses at every reroll; a saucer with no vertical
 * velocity has no direction to reverse, so it takes the weave direction it
 * carries, drawn when it entered or posed. Then, inside `SAUCER_AVOID_DIST` of
 * the star, the avoidance overrides the weave and drives it away from the core.
 */
export function saucerControl(state: ShatterState): void {
  const saucer = state.saucer;
  if (saucer === null) return;

  saucer.weaveTimer -= TICK_DT;
  const rerolling = saucer.weaveTimer <= 0;
  if (rerolling) saucer.weaveTimer += SAUCER_WEAVE_INTERVAL;
  if (!saucer.mind) return;

  if (rerolling) {
    const away = saucer.vy > 0 ? -1 : saucer.vy < 0 ? 1 : saucer.weave;
    saucer.vy = away * SAUCER_WEAVE_SPEED;
  }

  const dx = saucer.x - STAR_X;
  const dy = saucer.y - STAR_Y;
  if (Math.hypot(dx, dy) < SAUCER_AVOID_DIST) {
    const outward = dy >= 0 ? 1 : -1;
    saucer.vy = outward * SAUCER_WEAVE_SPEED * AVOID_SPEED_SCALE;
  }
}

/**
 * The saucer's locomotion, which is the whole of what its `travel` gates.
 *
 * The well never pulls it (`specs/gravity.md`), so it holds exactly the course
 * its mind steers. The push off the core rides with the mind rather than with the
 * travel: keeping clear of the core is something the saucer DOES, and a saucer
 * with its mind off is being asked to hold its course and nothing else.
 */
export function integrateSaucer(state: ShatterState): void {
  const saucer = state.saucer;
  if (saucer === null || !saucer.travel) return;
  travel(saucer, TICK_DT);
  if (saucer.mind) slideOffCore(saucer, SAUCER_R);
}

/**
 * The saucer's gun, which is the whole of what its `gun` gates.
 *
 * One shot every `SAUCER_FIRE_INTERVAL`, aimed at the ship's current position
 * across the shortest wrapped path, offset by an error drawn AFRESH FOR EVERY
 * SHOT, and leaving at `SAUCER_BULLET_SPEED` plus the saucer's own velocity. A
 * posed `nextSaucerAim` is the error of this shot, and the shot consumes it.
 */
export function saucerGun(state: ShatterState): void {
  const saucer = state.saucer;
  if (saucer === null) return;
  saucer.fireTimer -= TICK_DT;
  if (saucer.fireTimer > 0) return;
  saucer.fireTimer += SAUCER_FIRE_INTERVAL;
  if (!saucer.gun) return;

  const toShip = shortestDelta(saucer.x, saucer.y, state.ship.x, state.ship.y);
  const error =
    state.nextSaucerAim ?? range(-SAUCER_AIM_ERROR, SAUCER_AIM_ERROR);
  state.nextSaucerAim = null;
  const aim = Math.atan2(toShip.y, toShip.x) + error;
  state.enemyBullets.push(
    makeEnemyBullet(
      state,
      saucer.x,
      saucer.y,
      saucer.vx + Math.cos(aim) * SAUCER_BULLET_SPEED,
      saucer.vy + Math.sin(aim) * SAUCER_BULLET_SPEED,
    ),
  );
}

/**
 * The saucer leaves the field, and the cadence to the next one starts over.
 *
 * Every departure comes through here, the visit running out and a bullet
 * destroying it alike, because `specs/saucer.md` measures the gap to the next
 * arrival from the previous saucer LEAVING: the clock starts over and the gap is
 * drawn afresh, replacing whatever `saucerDue` held.
 */
export function departSaucer(state: ShatterState): void {
  state.saucer = null;
  state.saucerClock = 0;
  state.saucerDue = range(SAUCER_GAP_MIN, SAUCER_GAP_MAX);
}

/** A visit is finite: twelve seconds after it entered, the saucer leaves. */
export function tickSaucerLifetime(state: ShatterState): void {
  const saucer = state.saucer;
  if (saucer === null) return;
  saucer.age += TICK_DT;
  if (saucer.age >= SAUCER_LIFETIME) departSaucer(state);
}

/**
 * The game's own arrival of a saucer, which is the whole of what
 * `setSaucerSpawning` gates.
 *
 * The clock runs only while the field is clear of one, so the gap the
 * specification fixes is measured from one saucer LEAVING to the next arriving,
 * and at most one is ever up.
 */
export function saucerArrival(state: ShatterState): void {
  if (!state.saucerSpawning || state.saucer !== null) return;
  state.saucerClock += TICK_DT;
  if (state.saucerClock < state.saucerDue) return;
  state.saucer = enterSaucer(state);
  raise(state, CUES.saucer);
}
