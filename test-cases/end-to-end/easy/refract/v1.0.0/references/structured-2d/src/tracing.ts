// Refract — tracing: what a press, a move, and a release do to the beams.
//
// This is the game's ONE per-sample pointer-resolution path
// (specs/controls.md). The player controller feeds it the engine's ordered
// pointer samples, one at a time and in arrival order, and the debug surface's
// pointer operations feed it the same way — so a posed press and a player's
// press are the same event to the game, and the hit radius, the grab table,
// the limits, and the completion test run identically for both
// (specs/instrumentation.md).
//
// A press that targets a node begins a trace by the grab table — start a fresh
// beam at an emitter, resume a beam from either end, or shorten a beam to a
// node exactly one beam passes through — and while the trace is held, each
// pointer position is resolved ON ITS OWN: a move to the node behind the live
// end retracts one segment, a move to an adjacent node adds the segment when
// the limits in `src/rules.ts` permit it, and a refused move changes nothing
// while the trace stays live. The release leaves the beam exactly as drawn.
//
// The state is live, so every resolver MUTATES the `RefractState` it is handed
// and returns the events the sample raised, for the caller to play one cue per
// kind of event (specs/ui.md, Audio). A move that satisfies R9 solves the
// board ON THE SPOT: the trace ends, the beams stay exactly as drawn, and the
// mode's own solve transition runs, so the release edge that follows begins
// nothing and changes nothing.

import { sameCell, targetNode } from "./board";
import { onSolved } from "./flow";
import { beamComplete, boardSolved, canExtend } from "./rules";
import type {
  BeamState,
  Cell,
  Channel,
  PointerDevice,
  RefractState,
} from "./game";

/** What a resolved press, move, or release did, for the frame's cues. */
export interface TraceEvents {
  connect: boolean;
  retract: boolean;
  channelComplete: boolean;
  solved: boolean;
  /** Raised by the `clear` target, which the pointer reaches through here. */
  cleared: boolean;
}

/** A fresh all-quiet event record. */
export function noEvents(): TraceEvents {
  return {
    connect: false,
    retract: false,
    channelComplete: false,
    solved: false,
    cleared: false,
  };
}

/** Ors `from` into `into`, so one cue plays per kind of event per batch. */
export function mergeEvents(into: TraceEvents, from: TraceEvents): void {
  into.connect = into.connect || from.connect;
  into.retract = into.retract || from.retract;
  into.channelComplete = into.channelComplete || from.channelComplete;
  into.solved = into.solved || from.solved;
  into.cleared = into.cleared || from.cleared;
}

/** The beam belonging to a channel. Every present channel has exactly one. */
function beamOf(state: RefractState, channel: Channel): BeamState {
  const beam = state.beams.find((entry) => entry.channel === channel);
  if (!beam) {
    throw new Error(`Refract: no ${channel} beam on the current board`);
  }
  return beam;
}

/**
 * R9, evaluated after every change (specs/beams.md, Enforcement). A change
 * that solves the board ends the trace and runs the mode's solve transition;
 * any other change leaves the trace live.
 */
function settle(state: RefractState, events: TraceEvents): TraceEvents {
  if (boardSolved(state.board, state.beams)) {
    onSolved(state);
    events.solved = true;
  }
  return events;
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
  device: PointerDevice = "mouse",
): TraceEvents {
  state.pointer = { x, y, down: true, device };
  const events = noEvents();
  if (state.screen !== "playing" || state.tracing !== null) return events;
  const node = targetNode(state.board, x, y);
  if (!node) return events;
  const cell: Cell = { col: node.col, row: node.row };

  // Row 1 — an emitter of a channel whose beam carries no segments.
  if (node.kind === "emitter" && node.channel !== null) {
    const beam = beamOf(state, node.channel);
    if (beam.cells.length < 2) {
      beam.cells = [cell];
      state.tracing = { channel: node.channel };
      return events;
    }
  }

  // Row 2 — either end of a channel's beam, oriented so the grabbed end is
  // last. The stored order is what makes the two ends distinguishable
  // (specs/state.md).
  for (const beam of state.beams) {
    if (beam.cells.length === 0) continue;
    const first = beam.cells[0];
    const last = beam.cells[beam.cells.length - 1];
    if (sameCell(last, cell) || sameCell(first, cell)) {
      if (!sameCell(last, cell)) beam.cells.reverse();
      state.tracing = { channel: beam.channel };
      return events;
    }
  }

  // Row 3 — a node exactly one beam passes through: shorten to the LAST
  // occurrence in the held order, so the beam loses as few segments as it can.
  // A press on either end of a beam matched row 2, so this row always drops at
  // least one cell — a removal, so the sample carries the retract event
  // (specs/ui.md, Audio).
  const through = state.beams.filter((beam) =>
    beam.cells.some((visited) => sameCell(visited, cell)),
  );
  if (through.length === 1) {
    const beam = through[0];
    let lastIndex = -1;
    beam.cells.forEach((visited, index) => {
      if (sameCell(visited, cell)) lastIndex = index;
    });
    beam.cells = beam.cells.slice(0, lastIndex + 1);
    state.tracing = { channel: beam.channel };
    events.retract = true;
    return settle(state, events);
  }

  return events;
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
  device: PointerDevice = "mouse",
): TraceEvents {
  state.pointer = { x, y, down: state.pointer.down, device };
  const events = noEvents();
  if (state.screen !== "playing" || state.tracing === null) return events;
  const node = targetNode(state.board, x, y);
  if (!node) return events;
  const cell: Cell = { col: node.col, row: node.row };

  const channel = state.tracing.channel;
  const beam = beamOf(state, channel);
  const cells = beam.cells;
  const live = cells[cells.length - 1];
  if (sameCell(cell, live)) return events;

  // Retract: the node immediately behind the live end.
  if (cells.length >= 2 && sameCell(cell, cells[cells.length - 2])) {
    beam.cells = cells.slice(0, -1);
    events.retract = true;
    return settle(state, events);
  }

  // Extend, when the limits permit the segment; a refused move changes
  // nothing and the trace stays live.
  if (!canExtend(state.board, state.beams, channel, live, cell)) return events;
  const wasComplete = beamComplete(state.board, beam);
  beam.cells = [...cells, cell];
  events.connect = true;
  events.channelComplete = beamComplete(state.board, beam) && !wasComplete;
  return settle(state, events);
}

/**
 * The release edge (specs/controls.md, Releasing): the trace ends and the beam
 * stays exactly as drawn. A trace that added no segment leaves its channel's
 * beam carrying none, so a later press on either emitter starts it afresh.
 */
export function pointerUp(
  state: RefractState,
  device: PointerDevice = "mouse",
): TraceEvents {
  state.pointer = { ...state.pointer, down: false, device };
  const events = noEvents();
  if (state.screen !== "playing" || state.tracing === null) return events;
  const beam = beamOf(state, state.tracing.channel);
  if (beam.cells.length < 2) beam.cells = [];
  state.tracing = null;
  return events;
}

/**
 * The `clear` action (specs/controls.md, Clearing): every beam emptied at
 * once, the board's nodes untouched, any live trace ended. It applies on the
 * `playing` screen alone, and the returned flag reports whether there was a
 * segment to remove, which is the one case the clear cue plays for
 * (specs/ui.md).
 */
export function clearBeams(state: RefractState): boolean {
  if (state.screen !== "playing") return false;
  const cleared = state.beams.some((beam) => beam.cells.length >= 2);
  for (const beam of state.beams) beam.cells = [];
  state.tracing = null;
  return cleared;
}
