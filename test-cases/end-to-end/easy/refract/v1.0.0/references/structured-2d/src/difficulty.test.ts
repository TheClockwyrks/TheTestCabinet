// The difficulty floor's five measures, held to exact values.
//
// Each fixture below is one board and the values an INDEPENDENT enumeration
// of the spec's five measures (specs/modes/cascade.md "The difficulty
// floor") produced for it — solutions, determined share, branching factor,
// shared crystals, and routes per channel — together with the segment count
// of a solution. The boards span the interesting shapes: single-channel
// starters, crystal-heavy campaign layouts, and a dense three-channel bench.
// `measureDifficulty` must land on every figure exactly; a drifted tie-break,
// a miscounted crossing, or an off-by-one in the enumeration moves at least
// one of them.

import { describe, expect, it } from "vitest";
import { parseBoard } from "./board";
import { measureDifficulty } from "./difficulty";

interface Fixture {
  /** The board, in specs/board.md notation. */
  readonly rows: readonly string[];
  /** Distinct solutions. */
  readonly solutions: number;
  /** Segments of one solution. */
  readonly segmentCount: number;
  /** Channel-and-segment pairs common to every solution, as a share. */
  readonly determinedShare: number;
  /** Mean legal continuations per drawn segment over every replay. */
  readonly branching: number;
  /** Max crystals crossed by 2+ channels within a single solution. */
  readonly sharedCrystals: number;
  /** Routes per channel present, in CHANNELS order. */
  readonly routes: readonly number[];
}

const FIXTURES: Readonly<Record<string, Fixture>> = {
  "a dense 3x4 three-channel bench": {
    rows: ["S2D", "D22", "T2d", "StT"],
    solutions: 2,
    segmentCount: 13,
    determinedShare: 0.7692307692307693,
    branching: 2.0,
    sharedCrystals: 4,
    routes: [11, 8, 52],
  },
  "a 3x5 bench with a MAX_CHARGES crystal": {
    rows: ["T2t", "St2", "D3s", "T2.", "DS."],
    solutions: 3,
    segmentCount: 15,
    determinedShare: 0.6,
    branching: 1.8,
    sharedCrystals: 4,
    routes: [18, 6, 2],
  },
  "a crystal-laden 3x6 column": {
    rows: ["tTs", "s2S", "S22", "232", "22T", "DD."],
    solutions: 124,
    segmentCount: 23,
    determinedShare: 0.4782608695652174,
    branching: 2.4098877980364657,
    sharedCrystals: 8,
    routes: [666, 911, 598],
  },
  "campaign board 19": {
    rows: [".Dttt", ".dd3t", ".d2TT", "S2s2D", ".sSss"],
    solutions: 28,
    segmentCount: 23,
    determinedShare: 0.4782608695652174,
    branching: 2.481366459627329,
    sharedCrystals: 3,
    routes: [20, 26, 15],
  },
  "campaign board 22": {
    rows: [".tt2d.", ".t2t2d", "t1DdSd", "2.S3dD", "TT2sd.", ".ssss."],
    solutions: 77,
    segmentCount: 33,
    determinedShare: 0.3333333333333333,
    branching: 2.124754033844943,
    sharedCrystals: 4,
    routes: [14, 5, 118],
  },
  "a one-solution 3x3 opener": {
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
  for (const [label, fixture] of Object.entries(FIXTURES)) {
    it(`reads ${label} to the exact figures`, () => {
      const measured = measureDifficulty(parseBoard(fixture.rows), 513);
      expect(measured).not.toBeNull();
      if (measured === null) return;
      expect(measured.capped).toBe(false);
      expect(measured.solutions).toBe(fixture.solutions);
      expect(measured.segmentCount).toBe(fixture.segmentCount);
      expect(measured.determinedShare).toBeCloseTo(fixture.determinedShare, 9);
      expect(measured.branching).toBeCloseTo(fixture.branching, 9);
      expect(measured.sharedCrystals).toBe(fixture.sharedCrystals);
      expect(measured.routes).toEqual(fixture.routes);
    });
  }
});
