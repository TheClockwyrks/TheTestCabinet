// The symmetric factorization of `specs/statics.md`: `K = L D L^T` with `L`
// unit lower triangular and `D` diagonal, eliminating the unknowns in the order
// the caller assembled them and EXCHANGING NO ROW AND NO COLUMN.

import { SINGULAR_TOL } from "../constants";

/** The factorization stopped at a pivot the tolerance called zero. */
export interface SingularResult {
  readonly singular: true;
  /** The index of the pivot it stopped at. */
  readonly at: number;
  readonly pivot: number;
  readonly maxDiagonal: number;
}

export interface SolvedResult {
  readonly singular: false;
  readonly u: Float64Array;
}

export type LinearResult = SingularResult | SolvedResult;

/**
 * Solve the symmetric system `K u = F` of order `n`, `K` given row-major.
 *
 * The system is singular when a pivot's magnitude is AT OR BELOW `SINGULAR_TOL`
 * times the largest diagonal entry of that same supported `K`. "At or below"
 * settles both extremes `specs/statics.md` names: a system that has unknowns
 * and no stiffness anywhere has a largest diagonal of `0` and a first pivot of
 * `0`, so it is singular; and a system with no unknowns left has no pivots to
 * test, so it is regular with all displacements zero.
 */
export function solveSymmetric(
  k: Float64Array,
  f: Float64Array,
  n: number,
): LinearResult {
  let maxDiagonal = 0;
  for (let i = 0; i < n; i++) {
    maxDiagonal = Math.max(maxDiagonal, Math.abs(k[i * n + i]));
  }
  const l = new Float64Array(n * n);
  const d = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    let pivot = k[j * n + j];
    for (let m = 0; m < j; m++) pivot -= l[j * n + m] * l[j * n + m] * d[m];
    if (Math.abs(pivot) <= SINGULAR_TOL * maxDiagonal) {
      return { singular: true, at: j, pivot, maxDiagonal };
    }
    d[j] = pivot;
    l[j * n + j] = 1;
    for (let i = j + 1; i < n; i++) {
      let s = k[i * n + j];
      for (let m = 0; m < j; m++) s -= l[i * n + m] * l[j * n + m] * d[m];
      l[i * n + j] = s / pivot;
    }
  }
  // Forward substitution, the diagonal, then back substitution.
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = f[i];
    for (let m = 0; m < i; m++) s -= l[i * n + m] * y[m];
    y[i] = s;
  }
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) z[i] = y[i] / d[i];
  const u = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = z[i];
    for (let m = i + 1; m < n; m++) s -= l[m * n + i] * u[m];
    u[i] = s;
  }
  return { singular: false, u };
}
