// One direct-stiffness solve of `specs/statics.md`: assemble `K u = F` over the
// free displacements, factor it, read every member's axial force, and read each
// support's reaction back.

import { solveSymmetric } from "./linalg";
import type { Material } from "./types";
import { add, dot, scale, sub, type Vec3 } from "./vec";

/** A member as one solve sees it: its two node indices, and its geometry. */
export interface SolveMember {
  readonly id: number;
  readonly material: Material;
  readonly ia: number;
  readonly ib: number;
  readonly ea: number;
  readonly length: number;
  /** Unit, `a` toward `b`, at the prescribed geometry. */
  readonly direction: Vec3;
  readonly isCable: boolean;
}

export interface StiffnessSingular {
  readonly singular: true;
  /** The global displacement index the factorization stopped at. */
  readonly dof: number;
  readonly at: number;
}

export interface StiffnessSolved {
  readonly singular: false;
  /** Three per node, zero at every support. */
  readonly displacements: Float64Array;
  /** One per member, in the order they were handed in; positive is tension. */
  readonly forces: number[];
  /** By node index, for the supports alone. */
  readonly reactions: Map<number, Vec3>;
}

export type StiffnessResult = StiffnessSingular | StiffnessSolved;

/**
 * Solve one system.
 *
 * `nodeCount` nodes are given in the canonical order the caller fixed — for
 * `specs/statics.md` that is ascending LATTICE position, `x` then `y` then `z`
 * — and the free displacements are enumerated in that order, `x`, `y`, `z`
 * within each node, which is the elimination order the factorization uses.
 * Support rows and columns leave the system entirely.
 */
export function stiffnessSolve(
  nodeCount: number,
  members: readonly SolveMember[],
  supports: ReadonlySet<number>,
  f: Float64Array,
): StiffnessResult {
  const free: number[] = [];
  const map = new Int32Array(3 * nodeCount).fill(-1);
  for (let i = 0; i < nodeCount; i++) {
    if (supports.has(i)) continue;
    for (let c = 0; c < 3; c++) {
      map[3 * i + c] = free.length;
      free.push(3 * i + c);
    }
  }
  const n = free.length;
  const k = new Float64Array(n * n);
  const fFree = new Float64Array(n);
  for (let i = 0; i < n; i++) fFree[i] = f[free[i]];

  for (const m of members) {
    const stiffness = m.ea / m.length;
    const dir = m.direction;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const value = stiffness * dir[r] * dir[c];
        const pairs: readonly (readonly [number, number, number])[] = [
          [m.ia, m.ia, value],
          [m.ib, m.ib, value],
          [m.ia, m.ib, -value],
          [m.ib, m.ia, -value],
        ];
        for (const [a, b, v] of pairs) {
          const row = map[3 * a + r];
          const col = map[3 * b + c];
          if (row >= 0 && col >= 0) k[row * n + col] += v;
        }
      }
    }
  }

  // No unknowns left, every node of it a support: no pivots to test, regular.
  const result =
    n === 0
      ? ({ singular: false, u: new Float64Array(0) } as const)
      : solveSymmetric(k, fFree, n);
  if (result.singular) {
    return { singular: true, dof: free[result.at], at: result.at };
  }

  const displacements = new Float64Array(3 * nodeCount);
  for (let i = 0; i < n; i++) displacements[free[i]] = result.u[i];

  const forces = members.map((m) => {
    const du: Vec3 = [
      displacements[3 * m.ib] - displacements[3 * m.ia],
      displacements[3 * m.ib + 1] - displacements[3 * m.ia + 1],
      displacements[3 * m.ib + 2] - displacements[3 * m.ia + 2],
    ];
    return (m.ea / m.length) * dot(du, m.direction);
  });

  // "The reaction at a support node is minus the sum of the applied force there
  // and every member force pulling on it."
  const reactions = new Map<number, Vec3>();
  for (const i of supports) {
    let r: Vec3 = [-f[3 * i], -f[3 * i + 1], -f[3 * i + 2]];
    for (let mi = 0; mi < members.length; mi++) {
      const m = members[mi];
      if (m.ia === i) r = sub(r, scale(m.direction, forces[mi]));
      else if (m.ib === i) r = add(r, scale(m.direction, forces[mi]));
    }
    reactions.set(i, r);
  }

  return { singular: false, displacements, forces, reactions };
}
