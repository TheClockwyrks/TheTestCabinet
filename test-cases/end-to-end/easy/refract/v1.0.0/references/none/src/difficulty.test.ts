// The difficulty floor's five measures, checked against exact values.
//
// Each fixture below is a board in notation with the value every measure must
// come to. The expected values come from an independent enumeration of the
// spec's five measures (specs/modes/cascade.md "The difficulty floor") — a
// separate implementation of the same definitions, run over the same boards —
// so this file catches a drifted tie-break, a miscounted route, or a replay
// that branches from the wrong end, none of which a bounds check would see.
// Counts are compared exactly; the two ratios (determined share, branching)
// to nine decimal places.

import { describe, expect, it } from "vitest";
import { parseBoard } from "./board";
import { measureDifficulty } from "./difficulty";

interface Expected {
  /** The board, in notation rows. */
  readonly rows: readonly string[];
  /** Distinct solutions the board admits. */
  readonly solutions: number;
  /** Segments of one solution. */
  readonly segmentCount: number;
  /** Channel-and-segment pairs in every solution, as a share of segments. */
  readonly determinedShare: number;
  /** Mean legal continuations per drawn segment over every replay. */
  readonly branching: number;
  /** Max crystals crossed by 2+ channels within a single solution. */
  readonly sharedCrystals: number;
  /** Routes per channel present, in CHANNELS order. */
  readonly routes: readonly number[];
}

const FIXTURES: Readonly<Record<string, Expected>> = {
  "a dense 3x4 three-channel board": {
    rows: ["S2D", "D22", "T2d", "StT"],
    solutions: 2,
    segmentCount: 13,
    determinedShare: 0.7692307692307693,
    branching: 2.0,
    sharedCrystals: 4,
    routes: [11, 8, 52],
  },
  "a 3x5 board with a full crystal": {
    rows: ["T2t", "St2", "D3s", "T2.", "DS."],
    solutions: 3,
    segmentCount: 15,
    determinedShare: 0.6,
    branching: 1.8,
    sharedCrystals: 4,
    routes: [18, 6, 2],
  },
  "a crystal-heavy 3x6 board with many solutions": {
    rows: ["tTs", "s2S", "S22", "232", "22T", "DD."],
    solutions: 124,
    segmentCount: 23,
    determinedShare: 0.4782608695652174,
    branching: 2.4098877980364657,
    sharedCrystals: 8,
    routes: [666, 911, 598],
  },
  "a 5x5 three-channel board": {
    rows: [".Dttt", ".dd3t", ".d2TT", "S2s2D", ".sSss"],
    solutions: 28,
    segmentCount: 23,
    determinedShare: 0.4782608695652174,
    branching: 2.481366459627329,
    sharedCrystals: 3,
    routes: [20, 26, 15],
  },
  "a full-width 6x6 board": {
    rows: [".tt2d.", ".t2t2d", "t1DdSd", "2.S3dD", "TT2sd.", ".ssss."],
    solutions: 77,
    segmentCount: 33,
    determinedShare: 0.3333333333333333,
    branching: 2.124754033844943,
    sharedCrystals: 4,
    routes: [14, 5, 118],
  },
  "a tiny single-solution board": {
    rows: [".T.", "t.T", "tt."],
    solutions: 1,
    segmentCount: 4,
    determinedShare: 1.0,
    branching: 1.5,
    sharedCrystals: 0,
    routes: [1],
  },
};

describe("measureDifficulty", () => {
  for (const [name, expected] of Object.entries(FIXTURES)) {
    it(`measures ${name} exactly`, () => {
      const measured = measureDifficulty(parseBoard(expected.rows), 513);
      expect(measured).not.toBeNull();
      if (measured === null) return;
      expect(measured.capped).toBe(false);
      expect(measured.solutions).toBe(expected.solutions);
      expect(measured.segmentCount).toBe(expected.segmentCount);
      expect(measured.determinedShare).toBeCloseTo(expected.determinedShare, 9);
      expect(measured.branching).toBeCloseTo(expected.branching, 9);
      expect(measured.sharedCrystals).toBe(expected.sharedCrystals);
      expect(measured.routes).toEqual(expected.routes);
    });
  }
});
