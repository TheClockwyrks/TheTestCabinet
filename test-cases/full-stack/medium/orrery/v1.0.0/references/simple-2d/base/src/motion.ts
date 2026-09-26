// Orrery — the rigid motions an instruction imposes over a cycle
// (specs/simulation.md "Motion and carrying").
//
// An instruction imposes a RIGID MOTION on what it moves, parameterized by the
// fraction `t` from `0` to `1`. There are exactly three of them: no motion, a
// translation by one hex vector, and a rotation of 60 degrees about a hex. Every
// row of the specification's motion table is one of the three, so the rest of
// the simulation asks two questions of a motion and nothing else — where a point
// stands part-way through it, and which hex a mote resting on a hex lands on at
// its end.
//
// Naming the three as one value is also what makes the multi-hold agreement rule
// writable: "motions agree when they are all no motion, all the same translation
// vector, or all rotation about the same center in the same direction" is
// `sameMotion` below, and nothing else needs to know which instruction produced
// which motion.
//
// Two conventions run through this file. A rotation's `turn` is `1` clockwise
// and `-1` counterclockwise, matching the direction index step of
// specs/field.md. And a clockwise turn is a POSITIVE angle in stage
// coordinates, because the stage's `y` grows downward: rotating the offset
// `(HEX_PITCH, 0)` by `+60` degrees lands exactly on the stage offset of hex
// `(0, 1)`, which is where `rotateCW` sends hex `(1, 0)`.

import { DIRS } from "./figures";

import { addHex, hexCenter, negHex, rotateAbout, wrapDir } from "./hex";
import type { Hex, Motion, StagePoint, Turn } from "./types";

// The three declarations this module is written against are `src/types.ts`'s,
// because `CyclePlan` there carries a motion; they are re-exported here, where
// the operations over them live.
export type { Motion, StagePoint, Turn };

/** The motion of a part that does not move and carries nothing anywhere. */
export const REST: Motion = { kind: "rest" };

/** How many degrees one 60 degree step sweeps. */
export const STEP_DEGREES = 60;

/** A translation by one hex vector, held as its own value. */
export function translationMotion(vector: Hex): Motion {
  return { kind: "translate", vector: { q: vector.q, r: vector.r } };
}

/** A 60 degree rotation about `center`, clockwise when `turn` is `1`. */
export function rotationMotion(center: Hex, turn: Turn): Motion {
  return { kind: "rotate", center: { q: center.q, r: center.r }, turn };
}

/** The one hex step along spoke direction `spoke`, outward or inward. */
export function spokeVector(spoke: number, outward: boolean): Hex {
  const step = DIRS[wrapDir(spoke)];
  return outward ? { q: step.q, r: step.r } : negHex(step);
}

/**
 * Whether two imposed motions are the SAME motion (specs/simulation.md "Held
 * more than once"): both no motion, both the same translation vector, or both
 * rotation about the same center in the same direction.
 */
export function sameMotion(a: Motion, b: Motion): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "rest") return true;
  if (a.kind === "translate" && b.kind === "translate") {
    return a.vector.q === b.vector.q && a.vector.r === b.vector.r;
  }
  if (a.kind === "rotate" && b.kind === "rotate") {
    return (
      a.center.q === b.center.q &&
      a.center.r === b.center.r &&
      a.turn === b.turn
    );
  }
  return false;
}

/** The stage displacement one hex vector covers, by the formulas of specs/field.md. */
export function stageVector(vector: Hex): StagePoint {
  const origin = hexCenter({ q: 0, r: 0 });
  const at = hexCenter(vector);
  return { x: at.x - origin.x, y: at.y - origin.y };
}

/**
 * Where a point standing at `from` at the start of the cycle stands at fraction
 * `t`: a translation runs linearly in `t`, and a rotation sweeps
 * `STEP_DEGREES * t` degrees about its center.
 */
export function movePoint(
  from: StagePoint,
  motion: Motion,
  t: number,
): StagePoint {
  switch (motion.kind) {
    case "rest":
      return { x: from.x, y: from.y };
    case "translate": {
      const step = stageVector(motion.vector);
      return { x: from.x + step.x * t, y: from.y + step.y * t };
    }
    case "rotate": {
      const center = hexCenter(motion.center);
      const angle = (motion.turn * STEP_DEGREES * t * Math.PI) / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const dx = from.x - center.x;
      const dy = from.y - center.y;
      return {
        x: center.x + dx * cos - dy * sin,
        y: center.y + dx * sin + dy * cos,
      };
    }
  }
}

/**
 * The hex a mote resting on `cell` lands on at the end of `motion`. Every
 * motion carries a hex center onto a hex center, so this is the exact landing
 * rather than the rounding of a swept position.
 */
export function landHex(cell: Hex, motion: Motion): Hex {
  switch (motion.kind) {
    case "rest":
      return { q: cell.q, r: cell.r };
    case "translate":
      return addHex(cell, motion.vector);
    case "rotate":
      return rotateAbout(cell, motion.center, motion.turn);
  }
}
