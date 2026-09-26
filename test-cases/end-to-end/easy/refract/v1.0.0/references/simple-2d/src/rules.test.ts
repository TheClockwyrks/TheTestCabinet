// The ruleset: each limit accepting and refusing, and the completion
// conditions, exercised directly over posed boards and beams.

import { describe, expect, it } from "vitest";
import { parseBoard } from "./board";
import {
  beamComplete,
  boardSolved,
  canExtend,
  crystalSatisfied,
  incidentSegments,
  segmentKey,
  spentAt,
  usedSegmentKeys,
} from "./rules";
import type { BeamState, Cell } from "./game";

function cells(...pairs: [number, number][]): Cell[] {
  return pairs.map(([col, row]) => ({ col, row }));
}

function beam(
  channel: BeamState["channel"],
  ...pairs: [number, number][]
): BeamState {
  return { channel, cells: cells(...pairs) };
}

describe("segment bookkeeping", () => {
  it("keys a segment the same in either direction", () => {
    expect(segmentKey({ col: 1, row: 2 }, { col: 2, row: 1 })).toBe(
      segmentKey({ col: 2, row: 1 }, { col: 1, row: 2 }),
    );
  });

  it("collects every drawn segment and counts incidence", () => {
    const drawn = [beam("triangle", [0, 0], [1, 0], [2, 1])];
    expect(usedSegmentKeys(drawn).size).toBe(2);
    expect(incidentSegments(drawn, { col: 1, row: 0 })).toBe(2);
    expect(incidentSegments(drawn, { col: 0, row: 0 })).toBe(1);
    expect(incidentSegments(drawn, { col: 2, row: 0 })).toBe(0);
  });

  it("counts a crystal's spends as occurrences, crossings incomplete or not", () => {
    const drawn = [
      beam("triangle", [0, 0], [1, 1]), // ends ON the crystal: spent already
      beam("square", [0, 2], [1, 1], [2, 2]), // a completed crossing
    ];
    expect(spentAt(drawn, { col: 1, row: 1 })).toBe(2);
  });
});

describe("the limits", () => {
  // T t t     around a central 2-charge crystal, with a square channel below
  // t 2 T
  // S s S
  const board = parseBoard(["Ttt", "t2T", "SsS"]);

  it("R1: refuses a non-adjacent segment and an empty-cell endpoint", () => {
    const empty = parseBoard(["T.T"]);
    expect(
      canExtend(
        empty,
        [beam("triangle", [0, 0])],
        "triangle",
        cells([0, 0])[0],
        {
          col: 2,
          row: 0,
        },
      ),
    ).toBe(false);
    expect(
      canExtend(
        empty,
        [beam("triangle", [0, 0])],
        "triangle",
        cells([0, 0])[0],
        {
          col: 1,
          row: 0,
        },
      ),
    ).toBe(false);
  });

  it("R2: refuses another channel's emitter and lens", () => {
    // A triangle beam at the lens (0,1), beside square's nodes on row 2.
    const fromLens = [beam("triangle", [0, 0], [0, 1]), beam("square")];
    expect(
      canExtend(
        board,
        fromLens,
        "triangle",
        { col: 0, row: 1 },
        { col: 0, row: 2 },
      ),
    ).toBe(false); // square emitter
    expect(
      canExtend(
        board,
        fromLens,
        "triangle",
        { col: 0, row: 1 },
        { col: 1, row: 2 },
      ),
    ).toBe(false); // square lens
    expect(
      canExtend(
        board,
        fromLens,
        "triangle",
        { col: 0, row: 1 },
        { col: 1, row: 0 },
      ),
    ).toBe(true); // its own lens is fine
  });

  it("R3: refuses a segment already carried by any beam", () => {
    const drawn = [beam("triangle", [0, 0], [1, 0]), beam("square")];
    expect(
      canExtend(
        board,
        drawn,
        "triangle",
        { col: 1, row: 0 },
        { col: 0, row: 0 },
      ),
    ).toBe(false);
  });

  it("R4: refuses the crossing diagonal of a used diagonal", () => {
    const drawn = [beam("triangle", [1, 0], [2, 1]), beam("square")];
    // The other diagonal of the same 2x2 block: (2,0)-(1,1).
    expect(
      canExtend(
        board,
        drawn,
        "triangle",
        { col: 2, row: 0 },
        { col: 1, row: 1 },
      ),
    ).toBe(false);
    // A diagonal in a different block is unaffected.
    expect(
      canExtend(
        board,
        drawn,
        "triangle",
        { col: 0, row: 0 },
        { col: 1, row: 1 },
      ),
    ).toBe(true);
  });

  it("R5: an emitter carries at most one segment", () => {
    const drawn = [beam("triangle", [1, 0], [0, 0]), beam("square")];
    // Leaving the emitter the beam just entered would give it two.
    expect(
      canExtend(
        board,
        drawn,
        "triangle",
        { col: 0, row: 0 },
        { col: 0, row: 1 },
      ),
    ).toBe(false);
    // And entering an emitter that already has its one segment is refused.
    const returning = [
      beam("triangle", [0, 0], [0, 1], [1, 1]),
      beam("square"),
    ];
    expect(
      canExtend(
        board,
        returning,
        "triangle",
        { col: 1, row: 1 },
        { col: 0, row: 0 },
      ),
    ).toBe(false);
  });

  it("R5: a lens carries at most two segments of its channel", () => {
    // The triangle beam has passed through the lens at (1,0) once already.
    const drawn = [
      beam("triangle", [0, 0], [1, 0], [2, 0], [2, 1]),
      beam("square"),
    ];
    expect(
      canExtend(
        board,
        drawn,
        "triangle",
        { col: 2, row: 1 },
        { col: 1, row: 0 },
      ),
    ).toBe(false);
  });

  it("R5: a crystal is entered only while a charge is unspent", () => {
    const two = [
      beam("triangle", [0, 0], [1, 1], [2, 1]), // one charge spent
      beam("square", [0, 2], [1, 1], [2, 2]), // both spent now
    ];
    expect(spentAt(two, { col: 1, row: 1 })).toBe(2);
    const fresh = [beam("triangle", [0, 0], [0, 1]), ...two.slice(1)];
    // Entering with one charge left is allowed...
    expect(
      canExtend(
        board,
        fresh,
        "triangle",
        { col: 0, row: 1 },
        { col: 1, row: 1 },
      ),
    ).toBe(true);
    // ...and refused once every charge is spent, even along a fresh segment.
    const spentBoard = parseBoard(["T1T", ".t."]);
    const full = [
      beam("triangle", [0, 0], [1, 0], [2, 0]),
      beam("triangle", [1, 1]),
    ];
    expect(
      canExtend(
        spentBoard,
        full,
        "triangle",
        { col: 1, row: 1 },
        { col: 1, row: 0 },
      ),
    ).toBe(false);
  });

  it("R5: leaving a crystal spends nothing and is never refused for charge", () => {
    const one = parseBoard(["T1T"]);
    const entered = [beam("triangle", [0, 0], [1, 0])];
    expect(
      canExtend(
        one,
        entered,
        "triangle",
        { col: 1, row: 0 },
        { col: 2, row: 0 },
      ),
    ).toBe(true);
  });
});

describe("the completion conditions", () => {
  it("R6+R7: a beam is complete between its emitters through every lens", () => {
    const board = parseBoard(["TtT"]);
    expect(beamComplete(board, beam("triangle", [0, 0], [1, 0], [2, 0]))).toBe(
      true,
    );
    // Skipping the lens leaves the beam incomplete even emitter to emitter.
    const skip = parseBoard(["T.T", ".t."]);
    expect(beamComplete(skip, beam("triangle", [0, 0], [2, 0]))).toBe(false);
    // A partial beam is not complete, and neither is an untouched one.
    expect(beamComplete(board, beam("triangle", [0, 0], [1, 0]))).toBe(false);
    expect(beamComplete(board, beam("triangle"))).toBe(false);
  });

  it("R8: a crystal is satisfied only exactly spent with no end resting on it", () => {
    const board = parseBoard(["T1T"]);
    const crystal = board.nodes[1];
    expect(crystal.kind).toBe("crystal");
    expect(
      crystalSatisfied([beam("triangle", [0, 0], [1, 0], [2, 0])], crystal),
    ).toBe(true);
    expect(crystalSatisfied([beam("triangle", [0, 0], [1, 0])], crystal)).toBe(
      false,
    );
    expect(crystalSatisfied([], crystal)).toBe(false);
  });

  it("R9: solved needs every channel complete and every crystal satisfied", () => {
    const triangle = beam("triangle", [0, 0], [1, 0], [2, 0]);
    const square = beam("square", [0, 1], [1, 0], [2, 1]);
    const two = parseBoard(["T2T", "S.S"]);
    // Both beams complete and both charges spent, one crossing each: solved.
    expect(boardSolved(two, [triangle, square])).toBe(true);
    // The square beam still empty: a channel incomplete.
    expect(boardSolved(two, [triangle, beam("square")])).toBe(false);
    // On a one-charge crystal the same two crossings over-spend it.
    const one = parseBoard(["T1T", "S.S"]);
    expect(boardSolved(one, [triangle, square])).toBe(false);
  });

  it("R9: never true of the resting, channel-less board", () => {
    expect(boardSolved({ cols: 1, rows: 1, nodes: [] }, [])).toBe(false);
  });
});
