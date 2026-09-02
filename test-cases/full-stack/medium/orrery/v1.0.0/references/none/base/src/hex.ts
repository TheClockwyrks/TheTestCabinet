// Orrery — the hex field's geometry (specs/field.md).
//
// Axial coordinates `(q, r)` over pointy-top hexes, the stage position of a
// hex center, the six neighbor directions and the two rotation formulas, the
// bounded field, and the rule that turns a pointer position into the hex it
// targets. Every rotating part in specs/simulation.md moves by the formulas
// here, so this module is where a rotation is written once.
//
// Nothing here reads the canvas or the state: it is pure geometry over
// numbers, which is what lets the simulation be checked without a browser.

import {
  DIRS,
  FIELD_CX,
  FIELD_CY,
  FIELD_R,
  HEX_HIT_R,
  HEX_PITCH,
} from "./constants";
import type { Hex } from "./types";

/** `sqrt(3) / 2`, the row spacing of a pointy-top grid, as a fraction of the pitch. */
const ROW_RATIO = Math.sqrt(3) / 2;

/** The stage `x` of hex `(q, r)`'s center. */
export function hexX(q: number, r: number): number {
  return FIELD_CX + HEX_PITCH * (q + r / 2);
}

/**
 * The stage `y` of hex `(q, r)`'s center. A pointy-top row's height depends on
 * `r` alone, so `q` is named and unused: the signature mirrors `hexX`, and
 * specs/field.md states the pair together.
 */
export function hexY(_q: number, r: number): number {
  return FIELD_CY + HEX_PITCH * ROW_RATIO * r;
}

/** The stage position of a hex's center. */
export function hexCenter(hex: Hex): { x: number; y: number } {
  return { x: hexX(hex.q, hex.r), y: hexY(hex.q, hex.r) };
}

/** A hex value, built fresh so no caller shares another's. */
export function hex(q: number, r: number): Hex {
  return { q, r };
}

/** Whether two hexes name the same cell. */
export function sameHex(a: Hex, b: Hex): boolean {
  return a.q === b.q && a.r === b.r;
}

/** The sum of two axial coordinates. */
export function addHex(a: Hex, b: Hex): Hex {
  return { q: a.q + b.q, r: a.r + b.r };
}

/**
 * The opposite of an axial offset, kept canonical: negating `0` would leave
 * `-0`, which compares equal but reads differently in a deep comparison.
 */
export function negHex(offset: Hex): Hex {
  return { q: canonical(-offset.q), r: canonical(-offset.r) };
}

/** The difference of two axial coordinates, `a - b`. */
export function subHex(a: Hex, b: Hex): Hex {
  return { q: a.q - b.q, r: a.r - b.r };
}

/** The number of steps between two hexes, over the axial metric. */
export function hexDistance(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** Whether two hexes differ by one of `DIRS`. */
export function adjacent(a: Hex, b: Hex): boolean {
  return hexDistance(a, b) === 1;
}

/** The neighbor of `from` in direction `dir`, taken modulo six. */
export function neighbor(from: Hex, dir: number): Hex {
  return addHex(from, DIRS[wrapDir(dir)]);
}

/** A direction index brought into `0` to `5`. */
export function wrapDir(dir: number): number {
  return ((dir % 6) + 6) % 6;
}

/**
 * Negative zero and zero name the same cell, and a hex is compared by value
 * throughout this build, so a coordinate is kept canonical.
 */
function canonical(value: number): number {
  return value === 0 ? 0 : value;
}

/** An offset turned one sixty-degree step clockwise: `(q, r) -> (-r, q + r)`. */
export function rotateCW(offset: Hex): Hex {
  return { q: canonical(-offset.r), r: canonical(offset.q + offset.r) };
}

/** The same, counterclockwise: `(q, r) -> (q + r, -q)`. */
export function rotateCCW(offset: Hex): Hex {
  return { q: canonical(offset.q + offset.r), r: canonical(-offset.q) };
}

/**
 * An offset rotated `steps` sixty-degree steps clockwise about `(0, 0)`. Six
 * steps is the identity, so the turn is taken the shorter way round: `steps`
 * of `4` and `5` are two and one counterclockwise steps of the same rotation.
 */
export function rotateHex(offset: Hex, steps: number): Hex {
  const turns = wrapDir(steps);
  let cell: Hex = { q: canonical(offset.q), r: canonical(offset.r) };
  if (turns <= 3) {
    for (let i = 0; i < turns; i += 1) cell = rotateCW(cell);
    return cell;
  }
  for (let i = 0; i < 6 - turns; i += 1) cell = rotateCCW(cell);
  return cell;
}

/** A hex rotated `steps` steps clockwise about `center`. */
export function rotateAbout(point: Hex, center: Hex, steps: number): Hex {
  return addHex(center, rotateHex(subHex(point, center), steps));
}

/** Whether hex `(q, r)` lies on the field of radius `FIELD_R`. */
export function onField(q: number, r: number): boolean {
  return Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= FIELD_R;
}

/** Whether a hex lies on the field. */
export function hexOnField(cell: Hex): boolean {
  return onField(cell.q, cell.r);
}

/**
 * Every hex of the field, in reading order: ascending `r`, then ascending `q`,
 * which is the order the sigil phase of specs/simulation.md runs in.
 */
export function fieldHexes(): Hex[] {
  const cells: Hex[] = [];
  for (let r = -FIELD_R; r <= FIELD_R; r += 1) {
    for (let q = -FIELD_R; q <= FIELD_R; q += 1) {
      if (onField(q, r)) cells.push({ q, r });
    }
  }
  return cells;
}

/**
 * Order two hexes in reading order: ascending `r`, then ascending `q`. Negative
 * when `a` reads first (specs/simulation.md "The sigil phase").
 */
export function readingOrder(a: Hex, b: Hex): number {
  return a.r - b.r || a.q - b.q;
}

/**
 * The field hex a pointer position targets: the one whose center is nearest,
 * provided that distance is at most `HEX_HIT_R`, and `null` otherwise. Ties go
 * to the smaller `r`, then the smaller `q` (specs/field.md "Targeting a hex").
 */
export function hexAt(x: number, y: number): Hex | null {
  let best: Hex | null = null;
  let bestDistance = Infinity;
  for (const cell of fieldHexes()) {
    const dx = x - hexX(cell.q, cell.r);
    const dy = y - hexY(cell.q, cell.r);
    const distance = Math.hypot(dx, dy);
    if (distance > HEX_HIT_R) continue;
    // `fieldHexes` already walks in ascending `r` then ascending `q`, so a
    // strict comparison keeps the first of any tie, which is the winner.
    if (distance < bestDistance) {
      bestDistance = distance;
      best = cell;
    }
  }
  return best;
}
