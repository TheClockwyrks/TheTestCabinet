// Tracing: the grab table, extending, retracting, releasing, and clearing,
// exercised through the same press/move/release resolvers the engine's
// pointer samples and the debug surface's pointer operations both feed.

import { describe, expect, it } from "vitest";
import { cellCenter, emptyBeams, parseBoard } from "./board";
import { createInitialState } from "./flow";
import {
  clearBeams,
  mergeEvents,
  NO_EVENTS,
  pointerDown,
  pointerMove,
  pointerUp,
} from "./tracing";
import type { Cell, RefractState } from "./game";

/** A playing state posed onto a board written in notation. */
function onBoard(rows: string[]): RefractState {
  const board = parseBoard(rows);
  return {
    ...createInitialState(),
    board,
    beams: emptyBeams(board),
    screen: "playing",
  };
}

function press(state: RefractState, cell: Cell) {
  const [x, y] = cellCenter(cell, state.board);
  return pointerDown(state, x, y);
}

function moveTo(state: RefractState, cell: Cell) {
  const [x, y] = cellCenter(cell, state.board);
  return pointerMove(state, x, y);
}

function beamCells(state: RefractState, channel: string): Cell[] {
  const beam = state.beams.find((entry) => entry.channel === channel);
  return beam ? [...beam.cells] : [];
}

describe("beginning a trace", () => {
  it("starts a fresh beam at an emitter of an empty channel", () => {
    const { state } = press(onBoard(["TtT"]), { col: 0, row: 0 });
    expect(state.tracing).toEqual({ channel: "triangle" });
    expect(beamCells(state, "triangle")).toEqual([{ col: 0, row: 0 }]);
    expect(state.pointer.down).toBe(true);
  });

  it("begins nothing on an empty cell, off the board, or on a bare lens", () => {
    const start = onBoard(["T.T", ".t."]);
    for (const miss of [
      press(start, { col: 1, row: 0 }), // empty cell
      pointerDown(start, 10, 10), // off the board
      press(start, { col: 1, row: 1 }), // a lens carrying no beam
    ]) {
      expect(miss.state.tracing).toBeNull();
      expect(miss.state.beams).toEqual(start.beams);
      expect(miss.state.pointer.down).toBe(true);
    }
  });

  it("resumes a beam from its live end without reordering", () => {
    let state = onBoard(["TtT"]);
    state = press(state, { col: 0, row: 0 }).state;
    state = moveTo(state, { col: 1, row: 0 }).state;
    state = pointerUp(state).state;
    expect(state.tracing).toBeNull();

    const resumed = press(state, { col: 1, row: 0 });
    expect(resumed.state.tracing).toEqual({ channel: "triangle" });
    expect(beamCells(resumed.state, "triangle")).toEqual([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ]);
    // Resuming from an end drops nothing, so no retract plays.
    expect(resumed.events).toEqual(NO_EVENTS);
  });

  it("resumes a beam from its far end by reversing the held order", () => {
    let state = onBoard(["TtT"]);
    state = press(state, { col: 0, row: 0 }).state;
    state = moveTo(state, { col: 1, row: 0 }).state;
    state = pointerUp(state).state;

    state = press(state, { col: 0, row: 0 }).state;
    expect(beamCells(state, "triangle")).toEqual([
      { col: 1, row: 0 },
      { col: 0, row: 0 },
    ]);
    expect(state.tracing).toEqual({ channel: "triangle" });
  });

  it("shortens a beam to a mid node it alone passes through", () => {
    let state = onBoard(["Tttt", "...T"]);
    state = press(state, { col: 0, row: 0 }).state;
    for (const col of [1, 2, 3]) {
      state = moveTo(state, { col, row: 0 }).state;
    }
    state = pointerUp(state).state;

    const shortened = press(state, { col: 1, row: 0 });
    expect(beamCells(shortened.state, "triangle")).toEqual([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ]);
    expect(shortened.state.tracing).toEqual({ channel: "triangle" });
    // Shortening removes segments, so the frame carries the retract event.
    expect(shortened.events.retract).toBe(true);
    expect(shortened.events.connect).toBe(false);
  });

  it("keeps as many segments as it can when shortening at a crystal crossed twice", () => {
    // The triangle beam crosses the 2-charge crystal at (1,1) twice, coming
    // back to it around the lens at (2,1) — straight back would retract.
    let state = onBoard(["T.t", ".2t", "t.T"]);
    state = press(state, { col: 0, row: 0 }).state;
    for (const cell of [
      { col: 1, row: 1 },
      { col: 2, row: 0 },
      { col: 2, row: 1 },
      { col: 1, row: 1 },
      { col: 0, row: 2 },
    ]) {
      state = moveTo(state, cell).state;
    }
    state = pointerUp(state).state;
    expect(beamCells(state, "triangle")).toHaveLength(6);

    // Pressing the crystal keeps everything up to its LAST occurrence, and
    // the segment dropped is a removal, so the retract event is raised.
    const shortened = press(state, { col: 1, row: 1 });
    expect(shortened.events.retract).toBe(true);
    state = shortened.state;
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
    let state = onBoard(["T.T", ".2.", "S.S", "t.."]);
    state = press(state, { col: 0, row: 0 }).state;
    state = moveTo(state, { col: 1, row: 1 }).state;
    state = moveTo(state, { col: 2, row: 0 }).state;
    state = pointerUp(state).state;
    state = press(state, { col: 0, row: 2 }).state;
    state = moveTo(state, { col: 1, row: 1 }).state;
    state = moveTo(state, { col: 2, row: 2 }).state;
    state = pointerUp(state).state;

    const pressed = press(state, { col: 1, row: 1 });
    expect(pressed.state.tracing).toBeNull();
    expect(pressed.state.beams).toEqual(state.beams);
  });

  it("begins nothing on an emitter whose beam already has segments elsewhere", () => {
    let state = onBoard(["TtT"]);
    state = press(state, { col: 0, row: 0 }).state;
    state = moveTo(state, { col: 1, row: 0 }).state;
    state = pointerUp(state).state;

    const pressed = press(state, { col: 2, row: 0 });
    expect(pressed.state.tracing).toBeNull();
  });
});

describe("extending and retracting", () => {
  it("adds a permitted segment and reports the connect event", () => {
    let state = onBoard(["TtT"]);
    state = press(state, { col: 0, row: 0 }).state;
    const moved = moveTo(state, { col: 1, row: 0 });
    expect(moved.events.connect).toBe(true);
    expect(beamCells(moved.state, "triangle")).toEqual([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ]);
  });

  it("refuses a forbidden move, changing nothing, and the trace stays live", () => {
    let state = onBoard(["TtT", "SsS"]);
    state = press(state, { col: 0, row: 0 }).state;
    const refused = moveTo(state, { col: 1, row: 1 }); // square's lens
    expect(refused.events).toEqual(NO_EVENTS);
    expect(refused.state.tracing).toEqual({ channel: "triangle" });
    expect(beamCells(refused.state, "triangle")).toEqual([{ col: 0, row: 0 }]);
  });

  it("ignores a move to a node not adjacent to the live end", () => {
    let state = onBoard(["TtT", "..t"]);
    state = press(state, { col: 0, row: 0 }).state;
    const far = moveTo(state, { col: 2, row: 1 });
    expect(beamCells(far.state, "triangle")).toEqual([{ col: 0, row: 0 }]);
    expect(far.state.tracing).toEqual({ channel: "triangle" });
  });

  it("retracts one segment when the pointer backs onto the node behind", () => {
    let state = onBoard(["TtT"]);
    state = press(state, { col: 0, row: 0 }).state;
    state = moveTo(state, { col: 1, row: 0 }).state;
    const backed = moveTo(state, { col: 0, row: 0 });
    expect(backed.events.retract).toBe(true);
    expect(beamCells(backed.state, "triangle")).toEqual([{ col: 0, row: 0 }]);
    expect(backed.state.tracing).toEqual({ channel: "triangle" });
  });
});

describe("releasing", () => {
  it("keeps a partial beam for a later trace to resume", () => {
    let state = onBoard(["TttT"]);
    state = press(state, { col: 0, row: 0 }).state;
    state = moveTo(state, { col: 1, row: 0 }).state;
    const released = pointerUp(state);
    expect(released.state.tracing).toBeNull();
    expect(released.state.pointer.down).toBe(false);
    expect(beamCells(released.state, "triangle")).toHaveLength(2);
  });

  it("empties a beam whose trace added no segment", () => {
    let state = onBoard(["TtT"]);
    state = press(state, { col: 0, row: 0 }).state;
    const released = pointerUp(state);
    expect(beamCells(released.state, "triangle")).toEqual([]);
  });
});

describe("solving mid-trace", () => {
  it("ends the trace the moment R9 holds and leaves the beams as drawn", () => {
    let state = onBoard(["TtT"]);
    state = press(state, { col: 0, row: 0 }).state;
    state = moveTo(state, { col: 1, row: 0 }).state;
    const solving = moveTo(state, { col: 2, row: 0 });
    expect(solving.events.solved).toBe(true);
    expect(solving.events.channelComplete).toBe(true);
    expect(solving.state.tracing).toBeNull();
    expect(solving.state.screen).toBe("solved");
    expect(beamCells(solving.state, "triangle")).toHaveLength(3);

    // The release edge that follows begins nothing and changes nothing.
    const after = pointerUp(solving.state);
    expect(after.state.beams).toEqual(solving.state.beams);
    expect(after.state.screen).toBe("solved");
  });

  it("reports a channel completing without solving while a crystal is open", () => {
    let state = onBoard(["TtT", ".1."]);
    state = press(state, { col: 0, row: 0 }).state;
    state = moveTo(state, { col: 1, row: 0 }).state;
    const completing = moveTo(state, { col: 2, row: 0 });
    expect(completing.events.channelComplete).toBe(true);
    expect(completing.events.solved).toBe(false);
    expect(completing.state.screen).toBe("playing");
    expect(completing.state.tracing).toEqual({ channel: "triangle" });
  });
});

describe("clearing", () => {
  it("empties every beam at once and ends the trace, reporting a segment removed", () => {
    let state = onBoard(["TtT", "S.S"]);
    state = press(state, { col: 0, row: 0 }).state;
    state = moveTo(state, { col: 1, row: 0 }).state;
    const { state: cleared, cleared: hadSegments } = clearBeams(state);
    expect(hadSegments).toBe(true);
    expect(cleared.tracing).toBeNull();
    expect(cleared.beams.every((beam) => beam.cells.length === 0)).toBe(true);
    expect(cleared.board).toBe(state.board);
  });

  it("reports nothing to clear when no segment exists", () => {
    const idle = clearBeams(onBoard(["TtT"]));
    expect(idle.cleared).toBe(false);
  });

  it("does nothing off the playing screen", () => {
    const title = createInitialState();
    expect(clearBeams(title).state).toBe(title);
    expect(clearBeams(title).cleared).toBe(false);
  });
});

describe("event merging", () => {
  it("ors each flag so one cue plays per kind per frame", () => {
    const merged = mergeEvents(
      { ...NO_EVENTS, connect: true },
      { ...NO_EVENTS, retract: true },
    );
    expect(merged).toEqual({
      connect: true,
      retract: true,
      channelComplete: false,
      solved: false,
    });
  });
});
