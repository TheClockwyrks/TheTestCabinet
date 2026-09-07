// Kessler — the session records and their layouts.
//
// A `Session` is everything one run of play holds: the score, the lives, the
// wave, the deflector, the three rings, the balls, the falling pods, the
// effects. `KesslerState` in `src/game.ts` — the world's live game state —
// implements it, and every function here writes that live object in place. The boot layout is the state `reset`
// restores behind the title screen (`specs/instrumentation.md`); starting a
// session parks the first ball on it, and a wave transition relays the rings
// for the next wave (`specs/rings.md`). The span is derived: it is `72` while
// `widen` is in force, `30` while `narrow` is, and the `48`-degree baseline
// otherwise (`specs/pods.md`).

import {
  DEFLECTOR_BALL_CONTACT_RADIUS,
  DEFLECTOR_BASE_SPAN_DEG,
  DEFLECTOR_START_ANGLE_DEG,
  NARROW_SPAN_DEG,
  START_LIVES,
  START_WAVE,
  WIDEN_SPAN_DEG,
  type PodKind,
} from "./constants";
import { pointAt } from "./polar";
import { filledRings, type RingState } from "./rings";

/**
 * One live ball. Parked balls hold zero velocity until launched. `id` is this
 * build's own stable identity — the actor drawing the ball follows it — and
 * never reaches the snapshot.
 */
export interface Ball {
  readonly id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Whether the ball sits parked on the deflector. */
  parked: boolean;
  /** The simulation tick the ball spawned on, driving its spin frame's phase. */
  spawnTick: number;
}

/** One falling salvage pod. Its center angle is constant in flight. */
export interface Pod {
  readonly id: number;
  kind: PodKind;
  /** The pod's center radius from the stage center. */
  r: number;
  /** The pod's constant center angle, in degrees. */
  angleDeg: number;
}

/** The effects in force: three whole-tick timers and the shield. */
export interface Effects {
  widenTicks: number;
  narrowTicks: number;
  pierceTicks: number;
  shieldActive: boolean;
}

/** Everything one run of play holds. `KesslerState` implements it. */
export interface Session {
  score: number;
  lives: number;
  wave: number;
  /** The deflector's center angle, normalized into `[0, 360)`. */
  paddleAngleDeg: number;
  /** Ring 1, the innermost, first. */
  rings: RingState[];
  /** Every live ball, in spawn order, oldest first. */
  balls: Ball[];
  /** Every falling pod, in spawn order, oldest first. */
  pods: Pod[];
  effects: Effects;
  /** The next ball or pod identity, never reused within a session. */
  nextId: number;
}

/** The deflector's span in force, in degrees. */
export function spanOf(session: Session): number {
  if (session.effects.widenTicks > 0) return WIDEN_SPAN_DEG;
  if (session.effects.narrowTicks > 0) return NARROW_SPAN_DEG;
  return DEFLECTOR_BASE_SPAN_DEG;
}

/** Whether every ball pierces this instant (`specs/pods.md`). */
export function piercingNow(session: Session): boolean {
  return session.effects.pierceTicks > 0;
}

/** Effects at rest: no timer running, no shield. */
export function clearedEffects(): Effects {
  return { widenTicks: 0, narrowTicks: 0, pierceTicks: 0, shieldActive: false };
}

/**
 * Writes the boot layout onto `session`: score `0`, `3` lives, wave `1`, the
 * deflector at angle `90` with its baseline span, every slot filled at full
 * hit points with every ring at angle `0` and the wave-1 speeds, and no
 * balls, pods, or effects. This is the state behind the title screen;
 * starting the session parks the first ball on it. The identity counter is
 * the caller's, since it belongs to no layout.
 */
export function bootSession(session: Session): void {
  session.score = 0;
  session.lives = START_LIVES;
  session.wave = START_WAVE;
  session.paddleAngleDeg = DEFLECTOR_START_ANGLE_DEG;
  session.rings = filledRings(START_WAVE);
  session.balls = [];
  session.pods = [];
  session.effects = clearedEffects();
}

/**
 * Parks a fresh ball on the deflector: at radius `194` at the deflector's
 * center angle, following the deflector until launched
 * (`specs/deflector-and-ball.md`).
 */
export function parkFreshBall(session: Session, spawnTick: number): void {
  const at = pointAt(DEFLECTOR_BALL_CONTACT_RADIUS, session.paddleAngleDeg);
  session.nextId += 1;
  session.balls.push({
    id: session.nextId,
    x: at.x,
    y: at.y,
    vx: 0,
    vy: 0,
    parked: true,
    spawnTick,
  });
}

/** Moves the parked ball, if any, to the deflector's center angle. */
export function followPaddle(session: Session): void {
  const parked = session.balls.find((ball) => ball.parked);
  if (!parked) return;
  const at = pointAt(DEFLECTOR_BALL_CONTACT_RADIUS, session.paddleAngleDeg);
  parked.x = at.x;
  parked.y = at.y;
}

/**
 * Lays the rings out for wave `wave`: every slot refilled at full hit points,
 * ring angles reset to `0`, and the wave's orbit speeds in force
 * (`specs/rings.md`).
 */
export function layOutWave(session: Session, wave: number): void {
  session.wave = wave;
  session.rings = filledRings(wave);
}

/**
 * The clearing a life loss and the wave-clear event share: every timed
 * effect ends, the span returns to its baseline, the shield disappears, and
 * every falling pod is removed (`specs/pods.md`).
 */
export function clearVolatiles(session: Session): void {
  session.effects = clearedEffects();
  session.pods = [];
}
