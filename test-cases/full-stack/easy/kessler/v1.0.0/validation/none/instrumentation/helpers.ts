// instrumentation/helpers — the spec figures and shared readings this category's
// validators pose against, spelled over this project's constants so every
// engine's suite reads the same way.
//
// Everything here traces to a rendered spec: the ring layout and orbit formulas
// to specs/rings.md, the deflector's opening figures and the serve position to
// specs/deflector-and-ball.md, the six screens to specs/screens.md, and the
// snapshot fields the assertions read to specs/instrumentation.md. Nothing is a
// reading of the reference implementation.

import { assertCloseTo, assertEqual, assertLength, fail } from "../assert";
import {
  angularOffset,
  ballSpeed,
  DEG,
  HIT_POINTS,
  PADDLE_SPAN_BASE,
  PADDLE_START_ANGLE,
  pointAt,
  polarOf,
  RINGS,
  SCREENS,
  SERVE_RADIUS,
  slotArcCenterDeg,
  type Screen,
} from "../constants";
import { REQUIRED_OPS, type KesslerSnapshot } from "../harness";

export { REQUIRED_OPS };

/** The deflector's opening center angle (specs/deflector-and-ball.md). */
export const PADDLE_START = PADDLE_START_ANGLE;
/** The deflector's baseline span in degrees (specs/field.md). */
export const SPAN_BASE = PADDLE_SPAN_BASE;
/** Where a parked ball sits: radius 194 (specs/deflector-and-ball.md). */
export const SERVE_R = SERVE_RADIUS;
/** The points a hit awards, destruction aside (specs/scoring.md). */
export const HIT_AWARD = HIT_POINTS;

/** The ball speed of wave `w` (specs/deflector-and-ball.md). */
export const waveBallSpeed = ballSpeed;

/** The six screens, in specs/screens.md's table order. */
export const SIX_SCREENS: readonly Screen[] = SCREENS;

/** The screens that carry no menu, where `menu.index` rests at `0`. */
export const MENU_FREE_SCREENS: readonly Screen[] = [
  "howto",
  "playing",
  "waveclear",
  "gameover",
];

/** One ring's wave-layout figures, as specs/rings.md's table states them. */
export interface RingFigures {
  slots: number;
  fullHp: number;
  speedAtWave(w: number): number;
}

/** Ring 1 first, matching the snapshot's `rings` order. */
export const RING_FIGURES: readonly RingFigures[] = RINGS.map((spec) => ({
  slots: spec.slots,
  fullHp: spec.hp,
  speedAtWave: (w: number) => spec.speedAtWave(w),
}));

/** The center angle of slot `slot`'s target arc on ring `ring` at ring angle 0. */
export function slotCenter(ring: number, slot: number): number {
  return slotArcCenterDeg(ring, slot, 0);
}

/** The stage point at radius `r`, angle `thetaDeg`. */
export function toXy(r: number, thetaDeg: number): { x: number; y: number } {
  return pointAt(r, thetaDeg);
}

/** The polar reading of a stage point. */
export function toPolar(x: number, y: number): { r: number; thetaDeg: number } {
  const p = polarOf(x, y);
  return { r: p.r, thetaDeg: p.theta };
}

/** The wrap-aware angular offset from `fromDeg` to `toDeg`, in [-180, 180). */
export function offAngle(fromDeg: number, toDeg: number): number {
  return angularOffset(fromDeg, toDeg);
}

/**
 * A `spawnBall` pose by polar figures: at radius `r`, angle `thetaDeg`, with
 * radial speed `vr` (outward positive) and tangential speed `vt` (toward
 * `+theta` positive), as cartesian `spawnBall` arguments — the `n` and `t`
 * axes of specs/field.md at that angle.
 */
export function polarPose(
  r: number,
  thetaDeg: number,
  vr: number,
  vt: number,
): { x: number; y: number; vx: number; vy: number } {
  const cos = Math.cos(thetaDeg * DEG);
  const sin = Math.sin(thetaDeg * DEG);
  return {
    ...pointAt(r, thetaDeg),
    vx: vr * cos - vt * sin,
    vy: vr * sin + vt * cos,
  };
}

/** A ball's speed, off the velocity the snapshot reports. */
export function speedOf(ball: { vx: number; vy: number }): number {
  return Math.hypot(ball.vx, ball.vy);
}

/**
 * Assert the wave-`wave` layout of specs/rings.md stands in `s`: three rings,
 * every slot filled with a full-hit-point target, each ring's angle within
 * `angleTolDeg` of 0, and each ring's orbit speed at the wave-`wave` formula.
 */
export function assertWaveLaid(
  s: KesslerSnapshot,
  wave: number,
  angleTolDeg: number,
  context: string,
): void {
  assertEqual(s.wave, wave, `${context}: the wave counter`);
  assertLength(s.rings, 3, `${context}: the three rings`);
  for (const [i, figures] of RING_FIGURES.entries()) {
    const ring = s.rings[i];
    assertLength(
      ring.targets,
      figures.slots,
      `${context}: every slot of ring ${i + 1} filled`,
    );
    const slots = ring.targets.map((t) => t.slot).sort((a, b) => a - b);
    for (const [k, slot] of slots.entries()) {
      assertEqual(slot, k, `${context}: ring ${i + 1}'s slots, each once`);
    }
    for (const target of ring.targets) {
      assertEqual(
        target.hp,
        figures.fullHp,
        `${context}: ring ${i + 1}'s targets at full hit points`,
      );
    }
    const off = Math.abs(offAngle(0, ring.angleDeg));
    if (off > angleTolDeg) {
      fail(
        `ring ${i + 1}'s angle within ${angleTolDeg} degrees of 0 ` +
          `(${context})`,
        ring.angleDeg,
      );
    }
    assertCloseTo(
      ring.speedDegPerSec,
      figures.speedAtWave(wave),
      6,
      `${context}: ring ${i + 1}'s wave-${wave} orbit speed`,
    );
  }
}

/**
 * Assert exactly one ball stands in `s`, parked at the serve position: radius
 * 194 at the deflector's center angle (specs/deflector-and-ball.md).
 */
export function assertParkedOnDeflector(
  s: KesslerSnapshot,
  context: string,
): void {
  assertLength(s.balls, 1, `${context}: one ball`);
  const ball = s.balls[0];
  assertEqual(ball.parked, true, `${context}: the ball parked`);
  const at = toPolar(ball.x, ball.y);
  assertCloseTo(at.r, SERVE_R, 6, `${context}: parked at the serve radius`);
  assertCloseTo(
    offAngle(s.paddle.angleDeg, at.thetaDeg),
    0,
    6,
    `${context}: parked at the deflector's center angle`,
  );
}
