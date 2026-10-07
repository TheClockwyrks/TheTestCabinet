// The 2D transform a frame's drawing calls are read through.
//
// A build is free to draw under a transform — to translate to a HUD corner and
// draw at the origin, say — so the position a `fillText`, a `drawImage` or a
// `lineTo` names is only where it landed once the transform in force at that call
// is applied. Every reading that reports WHERE a frame drew something walks the
// frame's operations carrying this state, so the walk lives in one place.

import type { Point } from "./point";

/** A 2D affine transform, in the canvas's `[a, b, c, d, e, f]` order. */
export type Matrix = [number, number, number, number, number, number];

/** The transform that changes nothing. */
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `m` followed by `n`, in the canvas's own multiplication order. */
export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/** A tuple of exactly `N` `T`s, so a checked argument list keeps its length. */
export type Tuple<
  N extends number,
  T,
  R extends T[] = [],
> = R["length"] extends N ? R : Tuple<N, T, [...R, T]>;

/**
 * The leading `count` arguments when every one of them is a number.
 *
 * The length travels in the type, so a caller that asked for eight reads eight
 * numbers rather than eight possibly-absent ones.
 */
export function numbers<N extends number>(
  args: unknown[],
  count: N,
): Tuple<N, number> | null {
  const taken = args.slice(0, count);
  return taken.length === count && taken.every((v) => typeof v === "number")
    ? (taken as Tuple<N, number>)
    : null;
}

/** Where `(x, y)` lands under `m`. */
export function apply(m: Matrix, x: number, y: number): Point {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/**
 * The transform after `method(...args)` is applied to `current`.
 *
 * `null` for a call that is not a transform operation, which is how a walk tells
 * "this moved the pen" from "this drew something".
 */
export function transformed(
  current: Matrix,
  method: string,
  args: unknown[],
): Matrix | null {
  if (method === "translate") {
    const v = numbers(args, 2);
    return v ? multiply(current, [1, 0, 0, 1, v[0], v[1]]) : current;
  }
  if (method === "scale") {
    const v = numbers(args, 2);
    return v ? multiply(current, [v[0], 0, 0, v[1], 0, 0]) : current;
  }
  if (method === "rotate") {
    const v = numbers(args, 1);
    if (!v) return current;
    const c = Math.cos(v[0]);
    const s = Math.sin(v[0]);
    return multiply(current, [c, s, -s, c, 0, 0]);
  }
  if (method === "transform") {
    const v = numbers(args, 6);
    return v ? multiply(current, v as Matrix) : current;
  }
  if (method === "setTransform") {
    const v = numbers(args, 6);
    if (v) return v as Matrix;
    if (args.length === 0) return IDENTITY;
    if (typeof args[0] === "object" && args[0] !== null) {
      const m = args[0] as Record<string, unknown>;
      const parts = [m.a, m.b, m.c, m.d, m.e, m.f];
      if (parts.every((p) => typeof p === "number")) return parts as Matrix;
    }
    return current;
  }
  if (method === "resetTransform") return IDENTITY;
  return null;
}
