// The diagnostic sources: each named and each a zero-argument pure read of
// the live state it reaches through its accessor, reporting the facts
// specs/instrumentation.md lists for the overlay. The registration with the
// world's registry is one loop over these same sources, so they are driven
// here over a state of the suite's own.

import { describe, expect, it } from "vitest";
import { cellCenter, emptyBeams, parseBoard } from "./board";
import { diagnosticSources } from "./diagnostics";
import { RefractState } from "./game";
import { pointerDown, pointerMove, pointerUp } from "./tracing";

describe("the diagnostic sources", () => {
  const state = new RefractState();
  const sources = new Map(diagnosticSources(() => state));

  it("registers the facts the overlay is asked to show", () => {
    expect([...sources.keys()]).toEqual([
      "screen",
      "mode",
      "board",
      "beam triangle",
      "beam square",
      "beam diamond",
      "crystals",
      "solved",
      "pointer",
    ]);
  });

  it("reads the live state at each call, not a value it captured", () => {
    expect(sources.get("screen")?.()).toBe("title");
    expect(sources.get("board")?.()).toBe("0x0");
    expect(sources.get("beam triangle")?.()).toBe("-");
    expect(sources.get("crystals")?.()).toBe("-");
    expect(sources.get("solved")?.()).toBe(false);
    expect(sources.get("pointer")?.()).toBe("0, 0");

    state.board = parseBoard(["T1T", "S.S"]);
    state.beams = emptyBeams(state.board);
    state.screen = "playing";
    for (const cell of [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 2, row: 0 },
    ]) {
      const [x, y] = cellCenter(cell, state.board);
      if (cell.col === 0) pointerDown(state, x, y);
      else pointerMove(state, x, y);
    }
    pointerUp(state);
    pointerDown(state, 100, 200);

    expect(sources.get("screen")?.()).toBe("playing");
    expect(sources.get("board")?.()).toBe("3x2");
    expect(sources.get("beam triangle")?.()).toBe("2 seg, complete");
    expect(sources.get("beam square")?.()).toBe("0 seg");
    expect(sources.get("beam diamond")?.()).toBe("-");
    expect(sources.get("crystals")?.()).toBe("1/1");
    expect(sources.get("solved")?.()).toBe(false);
    expect(sources.get("pointer")?.()).toBe("100, 200 down");
  });
});
