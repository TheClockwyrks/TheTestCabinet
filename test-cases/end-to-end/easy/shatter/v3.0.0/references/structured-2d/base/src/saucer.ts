// Shatter — the enemy saucer: when it arrives, how it travels, how it shoots,
// and when it leaves.
//
// The saucer has three separable faculties and each is gated on its own, so a
// scenario can hold any two of them still: `mind` is what it DECIDES (the
// vertical weave, and keeping clear of the star's core), `gun` is what it
// SHOOTS, and `travel` is whether its centre moves at all. Nothing here reads
// more than one of them.
//
// Keeping clear of the core is a steering decision, so it belongs to the mind.
// It is written as an early, gentle answer rather than a late, violent one: a
// saucer whose approach brings it inside `AVOID_RADIUS` of the star climbs away
// from the star's row at the weave's own speed, which is the fastest vertical
// motion `specs/saucer.md` gives it. The radial clamp beneath that is the
// guarantee the specification actually states — at no moment does the saucer's
// circle overlap the core — rather than a path a crossing normally takes.

import {
  CORE_R,
  FIELD_H,
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
  FIELD_W,
} from "./constants";
import { addEnemyBulletTo, addSaucerTo } from "./entities";
import { deltaX, deltaY, wrapX, wrapY } from "./geometry";
import type { FrameCues } from "./audio";
import type { SaucerState, ShatterState } from "./game";
import { random, randomRange, randomSign } from "./rng";

/** How near the star an approach has to bring the saucer before it climbs. */
const AVOID_RADIUS = 220;

/** The standoff the radial guarantee holds, outside the surface it may touch. */
const CLEARANCE = CORE_R + SAUCER_R + 6;

/**
 * The saucer's steering for this tick: the weave it rerolls on its own clock,
 * and the climb away from the star an approach calls for.
 *
 * Both are decisions, so both are the mind's and neither runs with it off.
 */
export function steerSaucer(state: ShatterState): void {
  const saucer = state.saucer;
  if (saucer === null || !saucer.mind) return;

  saucer.weaveClock -= TICK_DT;
  if (saucer.weaveClock <= 1e-9) {
    // The weave reverses the vertical direction it is travelling in at that
    // moment; a saucer with no vertical motion yet takes a drawn direction.
    const direction = saucer.vy === 0 ? saucer.weave : -Math.sign(saucer.vy);
    saucer.vy = SAUCER_WEAVE_SPEED * direction;
    saucer.weaveClock += SAUCER_WEAVE_INTERVAL;
  }

  const dx = deltaX(STAR_X, saucer.x);
  const dy = deltaY(STAR_Y, saucer.y);
  if (Math.hypot(dx, dy) >= AVOID_RADIUS) return;

  // Away from the star's row, at the weave's own speed. A saucer exactly on the
  // row leans on the way it is already going, so the answer never dithers.
  const away =
    dy !== 0 ? Math.sign(dy) : saucer.vy !== 0 ? Math.sign(saucer.vy) : 1;
  saucer.vy = SAUCER_WEAVE_SPEED * away;
}

/**
 * The guarantee `specs/saucer.md` states: the saucer's circle never overlaps
 * the star's core.
 *
 * A crossing that steered early never reaches this, and one that somehow did is
 * put back on the standoff with its inward motion removed. It is part of the
 * steering, so it is the mind's.
 */
export function keepSaucerClearOfCore(saucer: SaucerState): void {
  if (!saucer.mind) return;

  const dx = deltaX(STAR_X, saucer.x);
  const dy = deltaY(STAR_Y, saucer.y);
  const d = Math.hypot(dx, dy);
  if (d >= CLEARANCE) return;

  const nx = d === 0 ? 0 : dx / d;
  const ny = d === 0 ? -1 : dy / d;
  saucer.x = wrapX(STAR_X + nx * CLEARANCE);
  saucer.y = wrapY(STAR_Y + ny * CLEARANCE);

  const inward = saucer.vx * nx + saucer.vy * ny;
  if (inward < 0) {
    saucer.vx -= inward * nx;
    saucer.vy -= inward * ny;
  }
}

/**
 * One aimed shot, offset by an error drawn afresh for this shot alone, or by
 * the error the debug surface posed for it, which the shot consumes.
 */
function fireSaucer(state: ShatterState, saucer: SaucerState): void {
  const bearing = Math.atan2(
    deltaY(saucer.y, state.ship.y),
    deltaX(saucer.x, state.ship.x),
  );
  const error =
    state.nextSaucerAim ?? randomRange(-SAUCER_AIM_ERROR, SAUCER_AIM_ERROR);
  state.nextSaucerAim = null;
  const aim = bearing + error;

  addEnemyBulletTo(
    state,
    saucer.x,
    saucer.y,
    saucer.vx + Math.cos(aim) * SAUCER_BULLET_SPEED,
    saucer.vy + Math.sin(aim) * SAUCER_BULLET_SPEED,
  );
}

/**
 * The game's own arrival: an edge, a row, a weave direction, and a heading into
 * the field. A posed edge or row is taken in place of its draw and consumed
 * (`specs/instrumentation.md`).
 */
function arrive(state: ShatterState, cues: FrameCues): void {
  const edge = state.nextSaucerEdge ?? (random() < 0.5 ? "left" : "right");
  state.nextSaucerEdge = null;
  const row = state.nextSaucerRow ?? randomRange(SAUCER_R, FIELD_H - SAUCER_R);
  state.nextSaucerRow = null;
  const fromLeft = edge === "left";
  const x = fromLeft ? SAUCER_R : FIELD_W - SAUCER_R;
  const saucer = addSaucerTo(
    state,
    x,
    row,
    fromLeft ? SAUCER_SPEED : -SAUCER_SPEED,
  );
  saucer.weave = randomSign();
  cues.saucer = true;
}

/** The visit's own clocks: its gun, its lifetime, and the gap after it. */
export function runSaucerSystems(state: ShatterState, cues: FrameCues): void {
  const saucer = state.saucer;

  if (saucer === null) {
    if (!state.saucerSpawning) return;
    state.saucerClock += TICK_DT;
    if (state.saucerClock >= state.saucerDue) arrive(state, cues);
    return;
  }

  saucer.age += TICK_DT;
  if (saucer.age >= SAUCER_LIFETIME) {
    state.saucer = null;
    state.saucerClock = 0;
    state.saucerDue = randomRange(SAUCER_GAP_MIN, SAUCER_GAP_MAX);
    return;
  }

  if (!saucer.gun) return;
  saucer.fireClock -= TICK_DT;
  if (saucer.fireClock <= 1e-9) {
    fireSaucer(state, saucer);
    saucer.fireClock += SAUCER_FIRE_INTERVAL;
  }
}
