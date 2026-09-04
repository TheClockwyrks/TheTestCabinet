// Shatter — the saucer (`specs/saucer.md`).
//
// The saucer is a powered craft with THREE separable faculties, and every rule
// below belongs to exactly one of them, which is what makes each one gateable on
// its own from the debug surface (`specs/instrumentation.md`):
//
//   * `mind`   — the weave it rerolls every SAUCER_WEAVE_INTERVAL, and the
//                steering that keeps it clear of the star's core.
//   * `gun`    — the aimed shot it takes every SAUCER_FIRE_INTERVAL.
//   * `travel` — its locomotion. Off, its centre holds where it stands, while
//                its mind and its gun run on.
//
// The core standoff is a decision about where the saucer is GOING, so it is only
// taken while the saucer is travelling: a saucer held in place is going nowhere
// and there is nothing to steer around. It answers `specs/saucer.md`'s
// requirement that the saucer's circle never overlap the core, with the margin
// this build chose (`SAUCER_AVOID_R` in `src/tuning.ts`) rather than a figure the
// specification fixes, which it deliberately does not.
//
// A shot leaves at the END of a tick, after everything has moved, so it is first
// seen where the saucer actually is rather than a tick's travel beyond it.

import {
  CUES,
  FIELD_H,
  FIELD_W,
  SAUCER_AIM_ERROR,
  SAUCER_BULLET_LIFE,
  SAUCER_BULLET_SPEED,
  SAUCER_FIRE_INTERVAL,
  SAUCER_FIRST_DELAY,
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
import { deltaX, deltaY } from "./geometry";
import {
  randRange,
  randSign,
  takeId,
  type FrameEvents,
  type MutSaucer,
  type Sim,
} from "./sim";
import { SAUCER_AVOID_R } from "./tuning";

/** Bring a saucer onto the field at `(x, y)`, travelling right at cruise. */
export function addSaucerAt(sim: Sim, x: number, y: number): MutSaucer {
  const saucer: MutSaucer = {
    id: takeId(sim),
    x,
    y,
    vx: SAUCER_SPEED,
    vy: 0,
    mind: true,
    gun: true,
    travel: true,
    fireClock: SAUCER_FIRE_INTERVAL,
    weaveClock: SAUCER_WEAVE_INTERVAL,
    age: 0,
  };
  sim.saucer = saucer;
  return saucer;
}

/**
 * The saucer has left the field, however it left.
 *
 * The gap to the next arrival is drawn here, because `specs/saucer.md` measures
 * it from the moment the previous saucer leaves rather than from its arrival.
 */
export function saucerLeft(sim: Sim): void {
  sim.saucer = null;
  sim.saucerClock = 0;
  sim.saucerDue = randRange(sim, SAUCER_GAP_MIN, SAUCER_GAP_MAX);
}

/** The control step for the saucer: the weave reroll, then the core standoff. */
export function steerSaucer(sim: Sim): void {
  const saucer = sim.saucer;
  if (saucer === null || !saucer.mind) return;

  saucer.weaveClock -= TICK_DT;
  if (saucer.weaveClock <= 1e-9) {
    saucer.weaveClock += SAUCER_WEAVE_INTERVAL;
    // The reroll reverses the vertical direction it is travelling in; the very
    // first one, taken from no vertical motion at all, draws its direction.
    const sign = saucer.vy > 0 ? -1 : saucer.vy < 0 ? 1 : randSign(sim);
    saucer.vy = sign * SAUCER_WEAVE_SPEED;
  }

  if (!saucer.travel) return;

  const dx = deltaX(STAR_X, saucer.x);
  const dy = deltaY(STAR_Y, saucer.y);
  if (Math.hypot(dx, dy) < SAUCER_AVOID_R) {
    const away = dy > 0 ? 1 : dy < 0 ? -1 : saucer.vy >= 0 ? 1 : -1;
    saucer.vy = away * SAUCER_WEAVE_SPEED;
  }
}

/** Count the saucer's lifetime down, and take it off the field when it is spent. */
export function ageSaucer(sim: Sim): void {
  const saucer = sim.saucer;
  if (saucer === null) return;

  saucer.age += TICK_DT;
  if (saucer.age >= SAUCER_LIFETIME) saucerLeft(sim);
}

/** Take the saucer's aimed shot, if its gun is on and its clock has run out. */
export function fireSaucer(sim: Sim): void {
  const saucer = sim.saucer;
  if (saucer === null || !saucer.gun) return;

  saucer.fireClock -= TICK_DT;
  if (saucer.fireClock > 1e-9) return;
  saucer.fireClock += SAUCER_FIRE_INTERVAL;

  const bearing =
    Math.atan2(deltaY(saucer.y, sim.ship.y), deltaX(saucer.x, sim.ship.x)) +
    randRange(sim, -SAUCER_AIM_ERROR, SAUCER_AIM_ERROR);

  sim.enemyBullets.push({
    id: takeId(sim),
    x: saucer.x,
    y: saucer.y,
    vx: saucer.vx + Math.cos(bearing) * SAUCER_BULLET_SPEED,
    vy: saucer.vy + Math.sin(bearing) * SAUCER_BULLET_SPEED,
    life: SAUCER_BULLET_LIFE,
  });
}

/**
 * The game's own arrival of a saucer.
 *
 * Arrivals happen while the ship is in play, at most one saucer at a time: the
 * first SAUCER_FIRST_DELAY into a game and each later one a drawn gap after the
 * previous saucer left.
 */
export function runSaucerCadence(sim: Sim, events: FrameEvents): void {
  if (sim.saucer !== null) return;

  sim.saucerClock += TICK_DT;
  if (!sim.saucerSpawning || sim.saucerClock < sim.saucerDue) return;

  const fromLeft = randSign(sim) > 0;
  const y = randRange(sim, SAUCER_R, FIELD_H - SAUCER_R);
  const saucer = addSaucerAt(sim, fromLeft ? SAUCER_R : FIELD_W - SAUCER_R, y);
  if (!fromLeft) saucer.vx = -SAUCER_SPEED;

  sim.saucerClock = 0;
  events.cues.add(CUES.saucer);
}

/** The cadence a new game starts on: the first saucer, SAUCER_FIRST_DELAY in. */
export function openingCadence(): readonly [number, number] {
  return [0, SAUCER_FIRST_DELAY];
}
