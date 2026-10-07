import { describe, expect, it } from "vitest";
import { SINGULAR_TOL } from "../constants";
import { solveSymmetric } from "./linalg";
import { stiffnessSolve, type SolveMember } from "./stiffness";

const matrix = (rows: number[][]): Float64Array =>
  Float64Array.from(rows.flat());

describe("solveSymmetric", () => {
  it("solves a regular system", () => {
    const result = solveSymmetric(
      matrix([
        [2, 1],
        [1, 3],
      ]),
      Float64Array.from([3, 4]),
      2,
    );
    expect(result.singular).toBe(false);
    if (result.singular) return;
    expect(result.u[0]).toBeCloseTo(1, 12);
    expect(result.u[1]).toBeCloseTo(1, 12);
  });

  it("stops at the first pivot the tolerance calls zero", () => {
    const result = solveSymmetric(
      matrix([
        [1, 0],
        [0, 0],
      ]),
      Float64Array.from([1, 0]),
      2,
    );
    expect(result.singular).toBe(true);
    if (!result.singular) return;
    expect(result.at).toBe(1);
    expect(result.maxDiagonal).toBe(1);
  });

  it("tests the pivot AT OR BELOW the tolerance, against that system's own largest diagonal", () => {
    const atTheTolerance = solveSymmetric(
      matrix([
        [1, 0],
        [0, SINGULAR_TOL],
      ]),
      Float64Array.from([0, 0]),
      2,
    );
    expect(atTheTolerance.singular).toBe(true);
    const justAbove = solveSymmetric(
      matrix([
        [1, 0],
        [0, 2 * SINGULAR_TOL],
      ]),
      Float64Array.from([0, 0]),
      2,
    );
    expect(justAbove.singular).toBe(false);
    // Relative, so the same matrix scaled up stays regular.
    const scaled = solveSymmetric(
      matrix([
        [1e6, 0],
        [0, 2e-2],
      ]),
      Float64Array.from([0, 0]),
      2,
    );
    expect(scaled.singular).toBe(false);
  });

  it("calls a system with unknowns and no stiffness anywhere singular", () => {
    const result = solveSymmetric(
      matrix([
        [0, 0],
        [0, 0],
      ]),
      Float64Array.from([1, 1]),
      2,
    );
    expect(result.singular).toBe(true);
    if (!result.singular) return;
    // The largest diagonal is 0 and the first pivot is 0: at or below.
    expect(result.at).toBe(0);
    expect(result.maxDiagonal).toBe(0);
  });

  it("calls a system with no unknowns left regular", () => {
    const result = solveSymmetric(new Float64Array(0), new Float64Array(0), 0);
    expect(result.singular).toBe(false);
  });
});

describe("stiffnessSolve", () => {
  const bar = (
    ia: number,
    ib: number,
    direction: [number, number, number],
  ): SolveMember => ({
    id: ia * 10 + ib,
    material: "strut",
    ia,
    ib,
    ea: 100,
    length: 1,
    direction,
    isCable: false,
  });

  it("is regular when every node is a support, with zero displacements", () => {
    const result = stiffnessSolve(
      2,
      [bar(0, 1, [1, 0, 0])],
      new Set([0, 1]),
      new Float64Array(6),
    );
    expect(result.singular).toBe(false);
    if (result.singular) return;
    expect([...result.displacements]).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("eliminates x, y, z within a node, in the node order it was handed", () => {
    // One bar along x holds node 1's x alone: its y is the first zero pivot,
    // which is global displacement index 3 * 1 + 1.
    const result = stiffnessSolve(
      2,
      [bar(0, 1, [1, 0, 0])],
      new Set([0]),
      new Float64Array(6),
    );
    expect(result.singular).toBe(true);
    if (!result.singular) return;
    expect(result.at).toBe(1);
    expect(result.dof).toBe(4);
  });

  it("balances the applied force with the reaction at the support", () => {
    const members = [
      bar(0, 1, [1, 0, 0]),
      bar(0, 1, [0, 1, 0]),
      bar(0, 1, [0, 0, 1]),
    ];
    const force = new Float64Array(6);
    force[3] = 50;
    force[4] = -20;
    const result = stiffnessSolve(2, members, new Set([0]), force);
    expect(result.singular).toBe(false);
    if (result.singular) return;
    const reaction = result.reactions.get(0);
    expect(reaction).toBeDefined();
    if (!reaction) return;
    expect(reaction[0]).toBeCloseTo(-50, 9);
    expect(reaction[1]).toBeCloseTo(20, 9);
    expect(reaction[2]).toBeCloseTo(0, 9);
  });
});
