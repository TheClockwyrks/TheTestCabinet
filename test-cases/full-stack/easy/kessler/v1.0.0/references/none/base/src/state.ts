// Kessler — the session state and its layouts.
//
// One `Session` is everything a run of play holds: the score, the lives, the
// wave, the deflector, the three rings, the balls, the falling pods, and the
// effects. The boot layout is the state `reset` restores behind the title
// screen (`specs/instrumentation.md`); starting a session parks the first
// ball on it, and a wave transition relays the rings for the next wave
// (`specs/rings.md`). The span is derived: it is `72` while `widen` is in
// force, `30` while `narrow` is, and the `48`-degree baseline otherwise
// (`specs/pods.md`).

import {
  BASE_SPAN_DEG,
  NARROW_SPAN_DEG,
  PADDLE_CONTACT_RADIUS,
  PADDLE_START_ANGLE,
  START_LIVES,
  WIDEN_SPAN_DEG,
  type PodKind,
} from "./constants";
import { pointAt } from "./polar";
import { filledRings, type RingState } from "./rings";

/** One live ball. Parked balls hold zero velocity until launched. */
export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Whether the ball sits parked on the deflector. */
  parked: boolean;
  /** The tick the ball spawned on, driving its spin frame's phase. */
  spawnTick: number;
}

/** One falling salvage pod. Its center angle is constant in flight. */
export interface Pod {
  kind: PodKind;
  /** The pod's center radius from the stage center. */
  r: number;
  /** The pod's constant center angle, in degrees. */
  angleDeg: number;
  /** The tick the pod spawned on. */
  spawnTick: number;
}

/** The effects in force: three whole-tick timers and the shield. */
export interface Effects {
  widenTicks: number;
  narrowTicks: number;
  pierceTicks: number;
  shieldActive: boolean;
}

/** Everything one run of play holds. */
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
}

/** The deflector's span in force, in degrees. */
export function spanOf(session: Session): number {
  if (session.effects.widenTicks > 0) return WIDEN_SPAN_DEG;
  if (session.effects.narrowTicks > 0) return NARROW_SPAN_DEG;
  return BASE_SPAN_DEG;
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
 * The boot layout: score `0`, `3` lives, wave `1`, the deflector at angle
 * `90` with its baseline span, every slot filled at full hit points with
 * every ring at angle `0` and the wave-1 speeds, and no balls, pods, or
 * effects. This is the state behind the title screen; starting the session
 * parks the first ball on it.
 */
export function bootSession(): Session {
  return {
    score: 0,
    lives: START_LIVES,
    wave: 1,
    paddleAngleDeg: PADDLE_START_ANGLE,
    rings: filledRings(1),
    balls: [],
    pods: [],
    effects: clearedEffects(),
  };
}

/**
 * Parks a fresh ball on the deflector: at radius `194` at the deflector's
 * center angle, following the deflector until launched
 * (`specs/deflector-and-ball.md`).
 */
export function parkFreshBall(session: Session, spawnTick: number): void {
  const at = pointAt(PADDLE_CONTACT_RADIUS, session.paddleAngleDeg);
  session.balls.push({
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
  const at = pointAt(PADDLE_CONTACT_RADIUS, session.paddleAngleDeg);
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
