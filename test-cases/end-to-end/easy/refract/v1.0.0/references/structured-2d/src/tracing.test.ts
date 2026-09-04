// Tracing: the grab table, extending, retracting, releasing, and clearing,
// exercised through the same per-sample resolvers the player controller's
// pointer samples and the debug surface's pointer operations both feed. The
// resolvers mutate the live state they are handed, so each check builds a
// bare `RefractState` — the class stands alone — and reads the fields back.

import { describe, expect, it } from "vitest";
import { cellCenter, emptyBeams, parseBoard } from "./board";
import { RefractState, type Cell } from "./game";
import {
  clearBeams,
  mergeEvents,
  noEvents,
  pointerDown,
  pointerMove,
  pointerUp,
  type TraceEvents,
} from "./tracing";

/** A playing state posed onto a board written in notation. */
function onBoard(rows: string[]): RefractState {
  const state = new RefractState();
  state.board = parseBoard(rows);
  state.beams = emptyBeams(state.board);
  state.screen = "playing";
  return state;
}

function press(state: RefractState, cell: Cell): TraceEvents {
  const [x, y] = cellCenter(cell, state.board);
  return pointerDown(state, x, y);
}

function moveTo(state: RefractState, cell: Cell): TraceEvents {
  const [x, y] = cellCenter(cell, state.board);
  return pointerMove(state, x, y);
}

function beamCells(state: RefractState, channel: string): Cell[] {
  const beam = state.beams.find((entry) => entry.channel === channel);
  return beam ? [...beam.cells] : [];
}

describe("beginning a trace", () => {
  it("starts a fresh beam at an emitter of an empty channel", () => {
    const state = onBoard(["TtT"]);
    press(state, { col: 0, row: 0 });
    expect(state.tracing).toEqual({ channel: "triangle" });
    expect(beamCells(state, "triangle")).toEqual([{ col: 0, row: 0 }]);
    expect(state.pointer.down).toBe(true);
  });

  it("begins nothing on an empty cell, off the board, or on a bare lens", () => {
    for (const miss of [
      { col: 1, row: 0 }, // empty cell
      null, // off the board
      { col: 1, row: 1 }, // a lens carrying no beam
    ]) {
      const state = onBoard(["T.T", ".t."]);
      const before = JSON.stringify(state.beams);
      if (miss === null) pointerDown(state, 10, 10);
      else press(state, miss);
      expect(state.tracing).toBeNull();
      expect(JSON.stringify(state.beams)).toBe(before);
      expect(state.pointer.down).toBe(true);
    }
  });

  it("resumes a beam from its live end without reordering", () => {
    const state = onBoard(["TtT"]);
    press(state, { col: 0, row: 0 });
    moveTo(state, { col: 1, row: 0 });
    pointerUp(state);
    expect(state.tracing).toBeNull();

    const events = press(state, { col: 1, row: 0 });
    expect(state.tracing).toEqual({ channel: "triangle" });
    expect(beamCells(state, "triangle")).toEqual([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ]);
    // Resuming from an end drops nothing, so no retract plays.
    expect(events).toEqual(noEvents());
  });

  it("resumes a beam from its far end by reversing the held order", () => {
    const state = onBoard(["TtT"]);
    press(state, { col: 0, row: 0 });
    moveTo(state, { col: 1, row: 0 });
    pointerUp(state);

    press(state, { col: 0, row: 0 });
    expect(beamCells(state, "triangle")).toEqual([
      { col: 1, row: 0 },
      { col: 0, row: 0 },
    ]);
    expect(state.tracing).toEqual({ channel: "triangle" });
  });

  it("shortens a beam to a mid node it alone passes through", () => {
    const state = onBoard(["Tttt", "...T"]);
    press(state, { col: 0, row: 0 });
    for (const col of [1, 2, 3]) {
      moveTo(state, { col, row: 0 });
    }
    pointerUp(state);

    const events = press(state, { col: 1, row: 0 });
    expect(beamCells(state, "triangle")).toEqual([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ]);
    expect(state.tracing).toEqual({ channel: "triangle" });
    // Shortening removes segments, so the sample carries the retract event.
    expect(events.retract).toBe(true);
    expect(events.connect).toBe(false);
  });

  it("keeps as many segments as it can when shortening at a crystal crossed twice", () => {
    // The triangle beam crosses the 2-charge crystal at (1,1) twice, coming
    // back to it around the lens at (2,1) — straight back would retract.
    const state = onBoard(["T.t", ".2t", "t.T"]);
    press(state, { col: 0, row: 0 });
    for (const cell of [
      { col: 1, row: 1 },
      { col: 2, row: 0 },
      { col: 2, row: 1 },
      { col: 1, row: 1 },
      { col: 0, row: 2 },
    ]) {
      moveTo(state, cell);
    }
    pointerUp(state);
    expect(beamCells(state, "triangle")).toHaveLength(6);

    // Pressing the crystal keeps everything up to its LAST occurrence, and
    // the segment dropped is a removal, so the retract event is raised.
    const events = press(state, { col: 1, row: 1 });
    expect(events.retract).toBe(true);
    expect(beamCells(state, "triangle")).toEqual([
      { col: 0, row: 0 },
      { col: 1, row: 1 },
      { col: 2, row: 0 },
      { col: 2, row: 1 },
      { col: 1, row: 1 },
    ]);
  });

  it("begins nothing on a node two beams share", () => {
    // Both channels cross the 2-charge crystal at (1,1); the stray triangle
    // lens on the last row keeps the board unsolved under the two traces.
    const state = onBoard(["T.T", ".2.", "S.S", "t.."]);
    press(state, { col: 0, row: 0 });
    moveTo(state, { col: 1, row: 1 });
    moveTo(state, { col: 2, row: 0 });
    pointerUp(state);
    press(state, { col: 0, row: 2 });
    moveTo(state, { col: 1, row: 1 });
    moveTo(state, { col: 2, row: 2 });
    pointerUp(state);

    const before = JSON.stringify(state.beams);
    press(state, { col: 1, row: 1 });
    expect(state.tracing).toBeNull();
    expect(JSON.stringify(state.beams)).toBe(before);
  });

  it("begins nothing on an emitter whose beam already has segments elsewhere", () => {
    const state = onBoard(["TtT"]);
    press(state, { col: 0, row: 0 });
    moveTo(state, { col: 1, row: 0 });
    pointerUp(state);

    press(state, { col: 2, row: 0 });
    expect(state.tracing).toBeNull();
  });
});

describe("extending and retracting", () => {
  it("adds a permitted segment and reports the connect event", () => {
    const state = onBoard(["TtT"]);
    press(state, { col: 0, row: 0 });
    const events = moveTo(state, { col: 1, row: 0 });
    expect(events.connect).toBe(true);
    expect(beamCells(state, "triangle")).toEqual([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ]);
  });

  it("refuses a forbidden move, changing nothing, and the trace stays live", () => {
    const state = onBoard(["TtT", "SsS"]);
    press(state, { col: 0, row: 0 });
    const events = moveTo(state, { col: 1, row: 1 }); // square's lens
    expect(events).toEqual(noEvents());
    expect(state.tracing).toEqual({ channel: "triangle" });
    expect(beamCells(state, "triangle")).toEqual([{ col: 0, row: 0 }]);
  });

  it("ignores a move to a node not adjacent to the live end", () => {
    const state = onBoard(["TtT", "..t"]);
    press(state, { col: 0, row: 0 });
    moveTo(state, { col: 2, row: 1 });
    expect(beamCells(state, "triangle")).toEqual([{ col: 0, row: 0 }]);
    expect(state.tracing).toEqual({ channel: "triangle" });
  });

  it("retracts one segment when the pointer backs onto the node behind", () => {
    const state = onBoard(["TtT"]);
    press(state, { col: 0, row: 0 });
    moveTo(state, { col: 1, row: 0 });
    const events = moveTo(state, { col: 0, row: 0 });
    expect(events.retract).toBe(true);
    expect(beamCells(state, "triangle")).toEqual([{ col: 0, row: 0 }]);
    expect(state.tracing).toEqual({ channel: "triangle" });
  });
});

describe("releasing", () => {
  it("keeps a partial beam for a later trace to resume", () => {
    const state = onBoard(["TttT"]);
    press(state, { col: 0, row: 0 });
    moveTo(state, { col: 1, row: 0 });
    pointerUp(state);
    expect(state.tracing).toBeNull();
    expect(state.pointer.down).toBe(false);
    expect(beamCells(state, "triangle")).toHaveLength(2);
  });

  it("empties a beam whose trace added no segment", () => {
    const state = onBoard(["TtT"]);
    press(state, { col: 0, row: 0 });
    pointerUp(state);
    expect(beamCells(state, "triangle")).toEqual([]);
  });
});

describe("solving mid-trace", () => {
  it("ends the trace the moment R9 holds and leaves the beams as drawn", () => {
    const state = onBoard(["TtT"]);
    press(state, { col: 0, row: 0 });
    moveTo(state, { col: 1, row: 0 });
    const events = moveTo(state, { col: 2, row: 0 });
    expect(events.solved).toBe(true);
    expect(events.channelComplete).toBe(true);
    expect(state.tracing).toBeNull();
    expect(state.screen).toBe("solved");
    expect(beamCells(state, "triangle")).toHaveLength(3);

    // The release edge that follows begins nothing and changes nothing.
    const before = JSON.stringify(state.beams);
    pointerUp(state);
    expect(JSON.stringify(state.beams)).toBe(before);
    expect(state.screen).toBe("solved");
  });

  it("reports a channel completing without solving while a crystal is open", () => {
    const state = onBoard(["TtT", ".1."]);
    press(state, { col: 0, row: 0 });
    moveTo(state, { col: 1, row: 0 });
    const events = moveTo(state, { col: 2, row: 0 });
    expect(events.channelComplete).toBe(true);
    expect(events.solved).toBe(false);
    expect(state.screen).toBe("playing");
    expect(state.tracing).toEqual({ channel: "triangle" });
  });
});

describe("clearing", () => {
  it("empties every beam at once and ends the trace, reporting a segment removed", () => {
    const state = onBoard(["TtT", "S.S"]);
    press(state, { col: 0, row: 0 });
    moveTo(state, { col: 1, row: 0 });
    const board = state.board;
    expect(clearBeams(state)).toBe(true);
    expect(state.tracing).toBeNull();
    expect(state.beams.every((beam) => beam.cells.length === 0)).toBe(true);
    expect(state.board).toBe(board);
  });

  it("reports nothing to clear when no segment exists", () => {
    expect(clearBeams(onBoard(["TtT"]))).toBe(false);
  });

  it("does nothing off the playing screen", () => {
    const title = new RefractState();
    expect(clearBeams(title)).toBe(false);
    expect(title.screen).toBe("title");
  });
});

describe("event merging", () => {
  it("ors each flag so one cue plays per kind per batch", () => {
    const merged = noEvents();
    mergeEvents(merged, { ...noEvents(), connect: true });
    mergeEvents(merged, { ...noEvents(), retract: true });
    expect(merged).toEqual({
      connect: true,
      retract: true,
      channelComplete: false,
      cleared: false,
      solved: false,
    });
  });
});
