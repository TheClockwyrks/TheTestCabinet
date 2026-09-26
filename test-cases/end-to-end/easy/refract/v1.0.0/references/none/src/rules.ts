// Refract — the ruleset (specs/beams.md).
//
// Two groups of rules over the board and the beams, and nothing else: the
// LIMITS R1–R5, checked on every move by `canExtend`, and the COMPLETION
// conditions R6–R9, read by `beamComplete`, `crystalSatisfied`, and
// `boardSolved`. The limits refuse; the completion conditions never do — a
// partial beam breaks no rule, it has simply not met them yet.
//
// Every function here is a pure read of the values it is handed. Whether a
// segment may be added is decided from the board and the beams alone — never
// from anything the renderer holds — which is what keeps the simulation
// driveable from code (specs/instrumentation.md).

import { adjacent, nodeAt, sameCell } from "./board";
import type { BeamState, BoardState, Cell, Channel, NodeState } from "./game";

/** A segment's canonical key: the same for either direction of travel. */
export function segmentKey(a: Cell, b: Cell): string {
  const first =
    a.row < b.row || (a.row === b.row && a.col < b.col) ? [a, b] : [b, a];
  return `${first[0].col},${first[0].row}|${first[1].col},${first[1].row}`;
}

/** Every segment the beams carry, keyed canonically. */
export function usedSegmentKeys(beams: readonly BeamState[]): Set<string> {
  const used = new Set<string>();
  for (const beam of beams) {
    for (let i = 1; i < beam.cells.length; i++) {
      used.add(segmentKey(beam.cells[i - 1], beam.cells[i]));
    }
  }
  return used;
}

/** How many segments, across all beams, meet the given cell. */
export function incidentSegments(
  beams: readonly BeamState[],
  cell: Cell,
): number {
  let count = 0;
  for (const beam of beams) {
    for (let i = 1; i < beam.cells.length; i++) {
      if (sameCell(beam.cells[i - 1], cell) || sameCell(beam.cells[i], cell)) {
        count++;
      }
    }
  }
  return count;
}

/**
 * A crystal's spent charge count: how many times its cell appears across the
 * beams. A charge is spent the moment a beam enters the crystal, whether or
 * not the crossing has been left again (specs/state.md), so occurrences are
 * exactly the spends.
 */
export function spentAt(beams: readonly BeamState[], cell: Cell): number {
  let count = 0;
  for (const beam of beams) {
    for (const visited of beam.cells) {
      if (sameCell(visited, cell)) count++;
    }
  }
  return count;
}

/** R5's cap for one endpoint of a prospective segment, or `null` for none. */
function capacityAfter(
  beams: readonly BeamState[],
  node: NodeState,
  entering: boolean,
): boolean {
  switch (node.kind) {
    case "emitter":
      // An emitter carries at most one segment.
      return incidentSegments(beams, node) + 1 <= 1;
    case "lens":
      // A lens carries at most two segments of its own channel — and R2 keeps
      // every other channel off it, so counting all beams counts its own.
      return incidentSegments(beams, node) + 1 <= 2;
    case "crystal":
      // The charge is spent on entry, so only entering a crystal is capped:
      // leaving completes the crossing the entry began and spends nothing.
      return !entering || spentAt(beams, node) + 1 <= (node.charges ?? 0);
  }
}

/**
 * Whether the limits R1–R5 permit adding the segment `from`–`to` to the given
 * channel's beam. `from` is the beam's live end; `to` is where the pointer is
 * asking to go. A `false` refuses the move: the beam is unchanged and the
 * trace stays live (specs/beams.md, Enforcement).
 */
export function canExtend(
  board: BoardState,
  beams: readonly BeamState[],
  channel: Channel,
  from: Cell,
  to: Cell,
): boolean {
  // R1 — adjacency, and a segment never spans an empty cell.
  const toNode = nodeAt(board, to.col, to.row);
  const fromNode = nodeAt(board, from.col, from.row);
  if (!toNode || !fromNode || !adjacent(from, to)) return false;

  // R2 — a beam never meets an emitter or a lens of another channel.
  if (toNode.kind !== "crystal" && toNode.channel !== channel) return false;

  const used = usedSegmentKeys(beams);

  // R3 — each segment is used at most once.
  if (used.has(segmentKey(from, to))) return false;

  // R4 — the two diagonals of a 2x2 block are mutually exclusive.
  if (from.col !== to.col && from.row !== to.row) {
    const crossing = segmentKey(
      { col: from.col, row: to.row },
      { col: to.col, row: from.row },
    );
    if (used.has(crossing)) return false;
  }

  // R5 — capacity at both endpoints. The segment leaves `from` and enters
  // `to`, and a crystal's charge is spent on entry alone.
  return (
    capacityAfter(beams, fromNode, false) && capacityAfter(beams, toNode, true)
  );
}

/**
 * R6 and R7: whether a channel's beam is complete. It runs between the
 * channel's two emitters with exactly one segment meeting each, and every lens
 * of the channel carries exactly two of its segments. Only this beam can touch
 * this channel's emitters and lenses (R2), so its own segments are the count.
 */
export function beamComplete(board: BoardState, beam: BeamState): boolean {
  if (beam.cells.length < 2) return false;
  const first = beam.cells[0];
  const last = beam.cells[beam.cells.length - 1];
  for (const cell of [first, last]) {
    const node = nodeAt(board, cell.col, cell.row);
    if (!node || node.kind !== "emitter" || node.channel !== beam.channel) {
      return false;
    }
    if (incidentSegments([beam], cell) !== 1) return false;
  }
  for (const node of board.nodes) {
    if (node.kind !== "lens" || node.channel !== beam.channel) continue;
    if (incidentSegments([beam], node) !== 2) return false;
  }
  return true;
}

/**
 * R8: whether a crystal is satisfied — every charge spent, and every crossing
 * begun across it completed. A beam that ends on the crystal has begun a
 * crossing it has not completed, so an end resting there leaves it open.
 */
export function crystalSatisfied(
  beams: readonly BeamState[],
  crystal: NodeState,
): boolean {
  if (spentAt(beams, crystal) !== (crystal.charges ?? 0)) return false;
  for (const beam of beams) {
    if (beam.cells.length === 0) continue;
    const first = beam.cells[0];
    const last = beam.cells[beam.cells.length - 1];
    if (sameCell(first, crystal) || sameCell(last, crystal)) return false;
  }
  return true;
}

/**
 * R9: the board is solved when R6 and R7 hold for every channel present and R8
 * holds for every crystal on the board.
 */
export function boardSolved(
  board: BoardState,
  beams: readonly BeamState[],
): boolean {
  // A board declares 1 to 3 channels (specs/board.md), so a channel-less board
  // is the resting placeholder the title screen holds, never a solved board.
  if (beams.length === 0) return false;
  for (const beam of beams) {
    if (!beamComplete(board, beam)) return false;
  }
  for (const node of board.nodes) {
    if (node.kind === "crystal" && !crystalSatisfied(beams, node)) return false;
  }
  return true;
}
