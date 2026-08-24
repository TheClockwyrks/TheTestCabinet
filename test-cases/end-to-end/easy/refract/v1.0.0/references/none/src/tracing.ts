// Refract — tracing: what a press, a move, and a release do to the beams.
//
// This is the game's defining interaction (specs/controls.md). A press that
// targets a node begins a trace by the grab table — start a fresh beam at an
// emitter, resume a beam from either end, or shorten a beam to a node exactly
// one beam passes through — and while the trace is held, each pointer position
// is resolved ON ITS OWN, in arrival order: a move to the node behind the live
// end retracts one segment, a move to an adjacent node adds the segment when
// the limits in `src/rules.ts` permit it, and a refused move changes nothing
// while the trace stays live. The release leaves the beam exactly as drawn.
//
// Every function takes the current state and returns the next beside the
// events the move raised, so `update` can play one cue per kind of event and
// the debug surface can drive the identical path with no cue bus in reach.
// A move that satisfies R9 solves the board ON THE SPOT: the trace ends, the
// beams stay exactly as drawn, and the mode's own solve transition runs, so
// the release edge that follows begins nothing and changes nothing.

import { sameCell, targetNode } from "./board";
import { onSolved } from "./flow";
import { beamComplete, boardSolved, canExtend } from "./rules";
import type { BeamState, Cell, Channel, RefractState } from "./game";

/** What a resolved press, move, or release did, for the frame's cues. */
export interface TraceEvents {
  readonly connect: boolean;
  readonly retract: boolean;
  readonly channelComplete: boolean;
  readonly solved: boolean;
}

export const NO_EVENTS: TraceEvents = {
  connect: false,
  retract: false,
  channelComplete: false,
  solved: false,
};

export function mergeEvents(a: TraceEvents, b: TraceEvents): TraceEvents {
  return {
    connect: a.connect || b.connect,
    retract: a.retract || b.retract,
    channelComplete: a.channelComplete || b.channelComplete,
    solved: a.solved || b.solved,
  };
}

export interface TraceResult {
  readonly state: RefractState;
  readonly events: TraceEvents;
}

/** The beam belonging to a channel. Every present channel has exactly one. */
function beamOf(state: RefractState, channel: Channel): BeamState {
  const beam = state.beams.find((entry) => entry.channel === channel);
  if (!beam) {
    throw new Error(`Refract: no ${channel} beam on the current board`);
  }
  return beam;
}

/** The beams with one channel's cells replaced, order preserved. */
function withCells(
  beams: readonly BeamState[],
  channel: Channel,
  cells: readonly Cell[],
): BeamState[] {
  return beams.map((beam) =>
    beam.channel === channel ? { ...beam, cells } : beam,
  );
}

/**
 * R9, evaluated after every change (specs/beams.md, Enforcement). A change
 * that solves the board ends the trace and runs the mode's solve transition;
 * any other change leaves the trace live.
 */
function settle(state: RefractState, events: TraceEvents): TraceResult {
  if (boardSolved(state.board, state.beams)) {
    return { state: onSolved(state), events: { ...events, solved: true } };
  }
  return { state, events };
}

/**
 * A press at a stage position (specs/controls.md, Beginning a trace).
 *
 * The grab table's rows are evaluated in order, and the first that matches
 * applies: an emitter of a channel whose beam carries no segments starts that
 * beam; either end of a beam resumes it, the beam oriented first so the
 * grabbed end is its last cell; a node exactly one beam passes through
 * shortens that beam to its last occurrence of the node and resumes there. A
 * press that matches no row — an empty cell, off the board, a bare node, or a
 * node two beams share — begins no trace and leaves the board unchanged.
 */
export function pointerDown(
  state: RefractState,
  x: number,
  y: number,
): TraceResult {
  const base: RefractState = { ...state, pointer: { x, y, down: true } };
  if (base.screen !== "playing" || base.tracing !== null) {
    return { state: base, events: NO_EVENTS };
  }
  const node = targetNode(base.board, x, y);
  if (!node) return { state: base, events: NO_EVENTS };
  const cell: Cell = { col: node.col, row: node.row };

  // Row 1 — an emitter of a channel whose beam carries no segments.
  if (node.kind === "emitter" && node.channel !== null) {
    const beam = beamOf(base, node.channel);
    if (beam.cells.length < 2) {
      return {
        state: {
          ...base,
          beams: withCells(base.beams, node.channel, [cell]),
          tracing: { channel: node.channel },
        },
        events: NO_EVENTS,
      };
    }
  }

  // Row 2 — either end of a channel's beam, oriented so the grabbed end is
  // last. The stored order is what makes the two ends distinguishable
  // (specs/state.md).
  for (const beam of base.beams) {
    if (beam.cells.length === 0) continue;
    const first = beam.cells[0];
    const last = beam.cells[beam.cells.length - 1];
    if (sameCell(last, cell) || sameCell(first, cell)) {
      const oriented = sameCell(last, cell)
        ? beam.cells
        : [...beam.cells].reverse();
      return {
        state: {
          ...base,
          beams: withCells(base.beams, beam.channel, oriented),
          tracing: { channel: beam.channel },
        },
        events: NO_EVENTS,
      };
    }
  }

  // Row 3 — a node exactly one beam passes through: shorten to the LAST
  // occurrence in the held order, so the beam loses as few segments as it can.
  // A press on either end of a beam matched row 2, so this row always drops at
  // least one cell — a removal, so the frame carries the retract event
  // (specs/ui.md, Audio).
  const through = base.beams.filter((beam) =>
    beam.cells.some((visited) => sameCell(visited, cell)),
  );
  if (through.length === 1) {
    const beam = through[0];
    let lastIndex = -1;
    beam.cells.forEach((visited, index) => {
      if (sameCell(visited, cell)) lastIndex = index;
    });
    const shortened = beam.cells.slice(0, lastIndex + 1);
    return settle(
      {
        ...base,
        beams: withCells(base.beams, beam.channel, shortened),
        tracing: { channel: beam.channel },
      },
      { ...NO_EVENTS, retract: true },
    );
  }

  return { state: base, events: NO_EVENTS };
}

/**
 * A pointer position while the trace is held (specs/controls.md, Extending and
 * Retracting). Retraction is checked first: the segment back to the node
 * behind the live end already exists, so R3 could never re-add it, and backing
 * the pointer along the beam unwinds it one segment at a time.
 */
export function pointerMove(
  state: RefractState,
  x: number,
  y: number,
): TraceResult {
  const base: RefractState = {
    ...state,
    pointer: { x, y, down: state.pointer.down },
  };
  if (base.screen !== "playing" || base.tracing === null) {
    return { state: base, events: NO_EVENTS };
  }
  const node = targetNode(base.board, x, y);
  if (!node) return { state: base, events: NO_EVENTS };
  const cell: Cell = { col: node.col, row: node.row };

  const channel = base.tracing.channel;
  const beam = beamOf(base, channel);
  const cells = beam.cells;
  const live = cells[cells.length - 1];
  if (sameCell(cell, live)) return { state: base, events: NO_EVENTS };

  // Retract: the node immediately behind the live end.
  if (cells.length >= 2 && sameCell(cell, cells[cells.length - 2])) {
    return settle(
      { ...base, beams: withCells(base.beams, channel, cells.slice(0, -1)) },
      { ...NO_EVENTS, retract: true },
    );
  }

  // Extend, when the limits permit the segment; a refused move changes
  // nothing and the trace stays live.
  if (!canExtend(base.board, base.beams, channel, live, cell)) {
    return { state: base, events: NO_EVENTS };
  }
  const extended = withCells(base.beams, channel, [...cells, cell]);
  const nowComplete = beamComplete(base.board, {
    channel,
    cells: [...cells, cell],
  });
  return settle(
    { ...base, beams: extended },
    {
      ...NO_EVENTS,
      connect: true,
      channelComplete: nowComplete && !beamComplete(base.board, beam),
    },
  );
}

/**
 * The release edge (specs/controls.md, Releasing): the trace ends and the beam
 * stays exactly as drawn. A trace that added no segment leaves its channel's
 * beam carrying none, so a later press on either emitter starts it afresh.
 */
export function pointerUp(state: RefractState): TraceResult {
  const base: RefractState = {
    ...state,
    pointer: { ...state.pointer, down: false },
  };
  if (base.screen !== "playing" || base.tracing === null) {
    return { state: base, events: NO_EVENTS };
  }
  const channel = base.tracing.channel;
  const beam = beamOf(base, channel);
  const beams =
    beam.cells.length < 2 ? withCells(base.beams, channel, []) : base.beams;
  return { state: { ...base, beams, tracing: null }, events: NO_EVENTS };
}

/**
 * The `clear` action (specs/controls.md, Clearing): every beam emptied at
 * once, the board's nodes untouched, any live trace ended. It applies on the
 * `playing` screen alone, and `cleared` reports whether there was a segment to
 * remove, which is the one case the clear cue plays for (specs/ui.md).
 */
export function clearBeams(state: RefractState): {
  state: RefractState;
  cleared: boolean;
} {
  if (state.screen !== "playing") return { state, cleared: false };
  const cleared = state.beams.some((beam) => beam.cells.length >= 2);
  const untouched =
    state.tracing === null &&
    state.beams.every((beam) => beam.cells.length === 0);
  if (untouched) return { state, cleared };
  return {
    state: {
      ...state,
      beams: state.beams.map((beam) => ({ ...beam, cells: [] })),
      tracing: null,
    },
    cleared,
  };
}
