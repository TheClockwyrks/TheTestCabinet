// Kessler — the formulas derived from the figures `src/constants.ts` fixes.
//
// The constants module carries every raw figure the specification states; this
// module is the arithmetic the rules read them through: the wave ball speed
// (`specs/deflector-and-ball.md`), each ring's orbit speed at a wave
// (`specs/rings.md`), and the pod-kind table lookup (`specs/pods.md`).

import {
  BALL_SPEED_BASE,
  BALL_SPEED_CAP,
  BALL_SPEED_PER_WAVE,
  POD_KIND_TABLE,
  RINGS,
  type PodKind,
} from "./constants";

/** One ring's fixed figures, as `src/constants.ts` states them. */
export type RingSpec = (typeof RINGS)[number];

/**
 * The ball speed of wave `w`: `240 + 30 * (w - 1)` units per second, capped
 * at `480`. A launch serves at it and a deflector bounce sets the ball to it.
 */
export function ballSpeedForWave(wave: number): number {
  return Math.min(
    BALL_SPEED_BASE + BALL_SPEED_PER_WAVE * (wave - 1),
    BALL_SPEED_CAP,
  );
}

/**
 * Ring `spec`'s orbit speed at wave `w`, in degrees per second, signed as
 * `specs/rings.md` signs it — so ring 1 is stationary at every wave.
 */
export function ringSpeedForWave(spec: RingSpec, wave: number): number {
  return (
    spec.orbitSign *
    Math.min(
      spec.orbitBaseDegPerSec + spec.orbitPerWaveDegPerSec * (wave - 1),
      spec.orbitCapDegPerSec,
    )
  );
}

/**
 * The kind a uniform draw `u` in `[0, 1)` lands on: the rows of
 * `POD_KIND_TABLE` laid end to end by probability, so each kind takes its
 * share of the unit interval.
 */
export function podKindForRoll(u: number): PodKind {
  let upTo = 0;
  for (const row of POD_KIND_TABLE) {
    upTo += row.probability;
    if (u < upTo) return row.kind;
  }
  return POD_KIND_TABLE[POD_KIND_TABLE.length - 1].kind;
}
