// Shatter — the saucer: its cadence, its crossing, its weave, and its gun.
//
// The saucer is a powered craft the well never pulls, and it is the one entity
// with three separable faculties: it decides (`mind`), it shoots (`gun`) and it
// moves (`travel`). Each is its own gate, and the three run independently, so a
// held saucer still rerolls its weave and still fires.
//
// Keeping clear of the star's core is one of the mind's decisions.
// `specs/saucer.md` requires only that the saucer's circle never overlaps the
// core; the standoff it actually steers to is `AVOID_DIST`, and it is reached by
// looking along the course it is on and answering with vertical speed alone, so
// the crossing speed stays exactly `SAUCER_SPEED` throughout.

import type { FrameCues } from "./audio";
import {
  FIELD_H,
  FIELD_W,
  SAUCER_AIM_ERROR,
  SAUCER_BULLET_SPEED,
  SAUCER_FIRE_INTERVAL,
  SAUCER_GAP_MAX,
  SAUCER_GAP_MIN,
  SAUCER_LIFETIME,
  SAUCER_R,
  SAUCER_SPEED,
  SAUCER_WEAVE_INTERVAL,
  SAUCER_WEAVE_SPEED,
  STAR_X,
  STAR_Y,
  TICK_DT,
} from "./constants";
import { addEnemyBulletTo, addSaucerTo } from "./entities";
import type { SaucerState, ShatterState } from "./game";
import { deltaX, deltaY, wrapX, wrapY } from "./geometry";
import { recordMove, type MoveTable } from "./motion";
import { nextFloat, nextRange, nextSign } from "./rng";
import { AVOID_DIST, AVOID_LOOKAHEAD } from "./tuning";

/** How close the saucer's current course brings it to the star's centre. */
function closestApproach(saucer: SaucerState): number {
  const relX = deltaX(saucer.x, STAR_X);
  const relY = deltaY(saucer.y, STAR_Y);
  const speedSquared = saucer.vx * saucer.vx + saucer.vy * saucer.vy;
  const at =
    speedSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            AVOID_LOOKAHEAD,
            (relX * saucer.vx + relY * saucer.vy) / speedSquared,
          ),
        );
  return Math.hypot(relX - saucer.vx * at, relY - saucer.vy * at);
}

/** Which way is away from the star's row: `-1` for up, `+1` for down. */
function awayFromStar(saucer: SaucerState): number {
  const toStar = deltaY(saucer.y, STAR_Y);
  if (toStar > 0) return -1;
  if (toStar < 0) return 1;
  return saucer.vy >= 0 ? 1 : -1;
}

/**
 * The saucer's mind: the weave it rerolls every `SAUCER_WEAVE_INTERVAL`, and the
 * steering that keeps it clear of the star's core.
 *
 * The weave's direction is opposite the vertical direction it is travelling in
 * at that moment, so its vertical direction reverses at every reroll; from no
 * vertical motion at all it takes the weave direction the saucer carries, drawn
 * when it entered or posed. The core steering overrides the result whenever the
 * course it is on would bring it inside the standoff.
 */
export function steerSaucer(state: ShatterState): void {
  const saucer = state.saucer;
  if (saucer === null || !saucer.mind) return;

  saucer.weaveClock -= TICK_DT;
  if (saucer.weaveClock <= 0) {
    saucer.weaveClock += SAUCER_WEAVE_INTERVAL;
    const direction = saucer.vy === 0 ? saucer.weave : saucer.vy > 0 ? -1 : 1;
    saucer.vy = direction * SAUCER_WEAVE_SPEED;
  }

  if (saucer.travel && closestApproach(saucer) < AVOID_DIST) {
    saucer.vy = awayFromStar(saucer) * SAUCER_WEAVE_SPEED;
  }
}

/** The saucer's travel, its lifetime, and the visit ending when it runs out. */
export function integrateSaucer(state: ShatterState, moves: MoveTable): void {
  const saucer = state.saucer;
  if (saucer === null) return;

  saucer.age += TICK_DT;
  if (saucer.age >= SAUCER_LIFETIME) {
    departSaucer(state);
    return;
  }

  let mx = 0;
  let my = 0;
  if (saucer.travel) {
    mx = saucer.vx * TICK_DT;
    my = saucer.vy * TICK_DT;
    saucer.x = wrapX(saucer.x + mx);
    saucer.y = wrapY(saucer.y + my);
  }
  recordMove(moves, saucer, mx, my);
}

/**
 * The saucer's gun: one shot every `SAUCER_FIRE_INTERVAL`, aimed at the ship's
 * current position and offset by an angle drawn afresh for every shot, or by
 * the error the debug surface posed for this one, which the shot consumes.
 */
export function fireSaucerGun(state: ShatterState): void {
  const saucer = state.saucer;
  if (saucer === null || !saucer.gun) return;

  saucer.fireClock -= TICK_DT;
  if (saucer.fireClock > 0) return;
  saucer.fireClock += SAUCER_FIRE_INTERVAL;

  const error =
    state.nextSaucerAim ?? nextRange(-SAUCER_AIM_ERROR, SAUCER_AIM_ERROR);
  state.nextSaucerAim = null;
  const aim =
    Math.atan2(deltaY(saucer.y, state.ship.y), deltaX(saucer.x, state.ship.x)) +
    error;

  addEnemyBulletTo(
    state,
    saucer.x,
    saucer.y,
    saucer.vx + Math.cos(aim) * SAUCER_BULLET_SPEED,
    saucer.vy + Math.sin(aim) * SAUCER_BULLET_SPEED,
  );
}

/** The visit ends: the slot empties and the gap to the next arrival is drawn. */
export function departSaucer(state: ShatterState): void {
  state.saucer = null;
  state.saucerDue = nextRange(SAUCER_GAP_MIN, SAUCER_GAP_MAX);
  state.saucerClock = 0;
}

/**
 * A saucer arrives: at the left edge or the right, at a row drawn across the
 * field, with a weave direction of its own. A posed edge or row is taken in
 * place of its draw and consumed (`specs/instrumentation.md`).
 */
export function arriveSaucer(state: ShatterState, cues: FrameCues): void {
  const edge = state.nextSaucerEdge ?? (nextFloat() < 0.5 ? "left" : "right");
  state.nextSaucerEdge = null;
  const row = state.nextSaucerRow ?? nextRange(SAUCER_R, FIELD_H - SAUCER_R);
  state.nextSaucerRow = null;
  const fromLeft = edge === "left";
  const saucer = addSaucerTo(
    state,
    fromLeft ? SAUCER_R : FIELD_W - SAUCER_R,
    row,
  );
  saucer.vx = fromLeft ? SAUCER_SPEED : -SAUCER_SPEED;
  saucer.weave = nextSign();
  cues.saucer = true;
}

/**
 * The game's own arrival cadence: `SAUCER_FIRST_DELAY` into a game, and a fresh
 * draw from `SAUCER_GAP_MIN` to `SAUCER_GAP_MAX` after each saucer leaves. The
 * clock runs only while the slot is empty, so the gap is measured from one
 * saucer leaving to the next arriving.
 */
export function advanceSaucerCadence(
  state: ShatterState,
  cues: FrameCues,
): void {
  if (state.saucer !== null) return;
  if (!state.saucerSpawning) return;

  state.saucerClock += TICK_DT;
  if (state.saucerClock >= state.saucerDue) {
    arriveSaucer(state, cues);
    state.saucerClock = 0;
  }
}
