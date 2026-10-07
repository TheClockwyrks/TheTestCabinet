// Shatter — the enemy saucer (`specs/saucer.md`).
//
// The saucer is a powered craft with three separable faculties, and this file
// keeps them separable: its MIND (the weave it rerolls every second and the
// steering that keeps it off the star's core), its GUN (the aimed shot every
// 1.6 seconds), and its TRAVEL (the crossing itself). Each has a gate the debug
// surface poses, and each part of the code below reads exactly the one it
// belongs to, so a scenario about how the saucer travels can hold its mind and
// its gun still without the craft ceasing to exist.
//
// THE CORE STANDOFF. The specification fixes one distance — the saucer's circle
// never overlaps the core, so its centre is never closer than `CORE_R +
// SAUCER_R` — and leaves how far outside that a build steers to the build. The
// two figures below are therefore this build's own, and are deliberately not in
// `src/constants.ts`, which carries only figures the specification fixes. The
// saucer starts turning away a long way out, so it clears the core by a wide
// margin on every course rather than by a hair on the lucky ones.

import {
  CORE_R,
  CUES,
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
import { separation, wrapX, wrapY } from "./field";
import { addEnemyBullet } from "./bullets";
import { random, range, sign } from "./rng";
import {
  countDown,
  takeId,
  type MutSaucer,
  type Sim,
  type TickEvents,
} from "./sim";

/** How close the saucer lets the star get before it steers away from it. */
const STANDOFF = 110;

/** How far ahead of itself the saucer looks for the star on its own row. */
const LOOKAHEAD = 320;

/** The centre distance the saucer's circle first touches the core at. */
export const CORE_STANDOFF = CORE_R + SAUCER_R;

/** Bring a saucer onto the field at a position, with all three faculties on. */
export function addSaucer(sim: Sim, x: number, y: number): MutSaucer {
  const saucer: MutSaucer = {
    id: takeId(sim),
    x: wrapX(x),
    y: wrapY(y),
    vx: SAUCER_SPEED,
    vy: 0,
    mind: true,
    gun: true,
    travel: true,
    // Down, for a saucer posed onto the field; an arrival draws its own.
    weave: 1,
    fireClock: SAUCER_FIRE_INTERVAL,
    weaveClock: SAUCER_WEAVE_INTERVAL,
    age: 0,
  };
  sim.saucer = saucer;
  return saucer;
}

/**
 * The game's own arrival: an edge, a row, a weave direction, heading into the
 * field. A posed edge or row is taken in place of its draw and consumed
 * (`specs/instrumentation.md`).
 */
export function arriveSaucer(sim: Sim, ev: TickEvents): void {
  const edge = sim.nextSaucerEdge ?? (random() < 0.5 ? "left" : "right");
  sim.nextSaucerEdge = null;
  const y = sim.nextSaucerRow ?? range(SAUCER_R, FIELD_H - SAUCER_R);
  sim.nextSaucerRow = null;
  const fromLeft = edge === "left";

  const saucer = addSaucer(sim, fromLeft ? SAUCER_R : FIELD_W - SAUCER_R, y);
  saucer.vx = fromLeft ? SAUCER_SPEED : -SAUCER_SPEED;
  saucer.weave = sign();
  ev.cues.add(CUES.saucer);
}

/** The saucer leaves, and the clock to the next visit starts over. */
export function departSaucer(sim: Sim): void {
  sim.saucer = null;
  sim.saucerClock = 0;
  sim.saucerDue = range(SAUCER_GAP_MIN, SAUCER_GAP_MAX);
}

/**
 * The saucer's mind: step 1's control forces for a powered craft.
 *
 * The weave reroll comes first, then the core standoff overrides it, because
 * avoiding the star is the decision that has to win. Both are the mind's, so a
 * saucer with its mind held makes neither.
 */
export function saucerMind(sim: Sim): void {
  const saucer = sim.saucer;
  if (saucer === null || !saucer.mind) return;

  saucer.weaveClock = countDown(saucer.weaveClock, TICK_DT);
  if (saucer.weaveClock === 0) {
    // Opposite the way it is going; from rest, the direction it carries.
    const direction = saucer.vy > 0 ? -1 : saucer.vy < 0 ? 1 : saucer.weave;
    saucer.vy = direction * SAUCER_WEAVE_SPEED;
    saucer.weaveClock = SAUCER_WEAVE_INTERVAL;
  }

  const [sx, sy] = separation(saucer.x, saucer.y, STAR_X, STAR_Y);
  const closing = sx * saucer.vx > 0;
  const nearby = Math.hypot(sx, sy) < STANDOFF;
  const onCourse =
    Math.abs(sy) < STANDOFF && closing && Math.abs(sx) < LOOKAHEAD;
  if (nearby || onCourse) {
    // Away from wherever the star is, and downward when it is dead ahead.
    saucer.vy = (sy >= 0 ? -1 : 1) * SAUCER_WEAVE_SPEED;
  }
}

/**
 * The standoff the mind guarantees, whatever the steering managed.
 *
 * The steering above turns away hundreds of units out, so on every course the
 * game itself produces this never fires. It is here because the specification
 * states the standoff as an absolute — at no moment does the saucer's circle
 * overlap the core — and an absolute wants a guarantee rather than a tendency.
 */
export function keepSaucerClearOfCore(sim: Sim): void {
  const saucer = sim.saucer;
  if (saucer === null || !saucer.mind) return;

  const [sx, sy] = separation(STAR_X, STAR_Y, saucer.x, saucer.y);
  const d = Math.hypot(sx, sy);
  if (d >= CORE_STANDOFF) return;

  const nx = d === 0 ? 0 : sx / d;
  const ny = d === 0 ? -1 : sy / d;
  saucer.x = wrapX(STAR_X + nx * CORE_STANDOFF);
  saucer.y = wrapY(STAR_Y + ny * CORE_STANDOFF);
}

/** The saucer's gun: one aimed shot every `SAUCER_FIRE_INTERVAL`. */
export function saucerGun(sim: Sim): void {
  const saucer = sim.saucer;
  if (saucer === null || !saucer.gun) return;

  saucer.fireClock = countDown(saucer.fireClock, TICK_DT);
  if (saucer.fireClock > 0) return;
  saucer.fireClock = SAUCER_FIRE_INTERVAL;

  const [dx, dy] = separation(saucer.x, saucer.y, sim.ship.x, sim.ship.y);
  // Drawn afresh for every shot, or the error the debug surface posed for this
  // one, which the shot consumes.
  const error = sim.nextSaucerAim ?? range(-SAUCER_AIM_ERROR, SAUCER_AIM_ERROR);
  sim.nextSaucerAim = null;

  const bearing = Math.atan2(dy, dx) + error;
  addEnemyBullet(
    sim,
    saucer.x,
    saucer.y,
    saucer.vx + Math.cos(bearing) * SAUCER_BULLET_SPEED,
    saucer.vy + Math.sin(bearing) * SAUCER_BULLET_SPEED,
  );
}

/** The visit's own clock: it leaves `SAUCER_LIFETIME` after it entered. */
export function saucerLife(sim: Sim): void {
  const saucer = sim.saucer;
  if (saucer === null) return;
  saucer.age += TICK_DT;
  if (saucer.age >= SAUCER_LIFETIME - 1e-9) departSaucer(sim);
}

/** The game's own arrival cadence, while no saucer is up. */
export function runSaucerCadence(sim: Sim, ev: TickEvents): void {
  if (sim.saucer !== null) return;
  sim.saucerClock += TICK_DT;
  if (!sim.saucerSpawning) return;
  if (sim.saucerClock >= sim.saucerDue - 1e-9) arriveSaucer(sim, ev);
}
