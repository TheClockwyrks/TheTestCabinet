/**
 * rules.ts — a pure implementation of the Refract ruleset over a Board plus a
 * set of per-channel beams. This is the oracle a validator uses for expected
 * values.
 *
 * Derived from specs/beams.md alone:
 *   - Limits R1 (adjacency), R2 (exclusion), R3 (segment exclusivity),
 *     R4 (diagonal exclusivity), R5 (capacity, including the crystal
 *     entry/crossing semantics and the spent-crystal refusal). Checked on
 *     every move; a move that would break one is refused and the beam is
 *     unchanged.
 *   - Completion R6 (endpoints), R7 (coverage), R8 (crystals), R9 (solved).
 *     Never used to refuse a move; R9 is evaluated after every change.
 *
 * A beam is represented as the ordered list of the cells it links, in the
 * drawn order (specs/controls.md "The drawn order"): a beam of k cells
 * carries k-1 segments. An empty or absent list is a beam carrying no
 * segments; a single-cell list is a just-begun trace with no segments yet.
 */

import type { Board, BoardNode, Channel } from "./notation";
import { CHANNELS, channelsPresent } from "./notation";

export interface Cell {
  col: number;
  row: number;
}

/** One beam per channel, each an ordered cell list (the drawn order). */
export type Beams = Partial<Record<Channel, Cell[]>>;

export type LimitRule = "R1" | "R2" | "R3" | "R4" | "R5";

export type MoveVerdict =
  { ok: true } | { ok: false; rule: LimitRule; reason: string };

// ---------------------------------------------------------------------------
// Lookup helpers.
// ---------------------------------------------------------------------------

export function sameCell(a: Cell, b: Cell): boolean {
  return a.col === b.col && a.row === b.row;
}

export function cellKey(c: Cell): string {
  return `${c.col},${c.row}`;
}

export function nodeAt(
  board: Board,
  col: number,
  row: number,
): BoardNode | undefined {
  return board.nodes.find((n) => n.col === col && n.row === row);
}

export function emittersOf(board: Board, channel: Channel): BoardNode[] {
  return board.nodes
    .filter((n) => n.kind === "emitter" && n.channel === channel)
    .sort((a, b) => a.row - b.row || a.col - b.col);
}

export function lensesOf(board: Board, channel: Channel): BoardNode[] {
  return board.nodes
    .filter((n) => n.kind === "lens" && n.channel === channel)
    .sort((a, b) => a.row - b.row || a.col - b.col);
}

export function crystalsOf(board: Board): BoardNode[] {
  return board.nodes
    .filter((n) => n.kind === "crystal")
    .sort((a, b) => a.row - b.row || a.col - b.col);
}

// ---------------------------------------------------------------------------
// Segment accounting.
// ---------------------------------------------------------------------------

/** Normalized key of the segment joining a and b (undirected). */
export function segmentKey(a: Cell, b: Cell): string {
  const ka = cellKey(a);
  const kb = cellKey(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

/** R1's adjacency test: cells differ by at most 1 on each axis and are not the same cell. */
export function isAdjacent(a: Cell, b: Cell): boolean {
  return (
    !sameCell(a, b) &&
    Math.abs(a.col - b.col) <= 1 &&
    Math.abs(a.row - b.row) <= 1
  );
}

export function isDiagonal(a: Cell, b: Cell): boolean {
  return Math.abs(a.col - b.col) === 1 && Math.abs(a.row - b.row) === 1;
}

/**
 * For a diagonal segment, the 2x2 block it is a diagonal of, keyed by the
 * block's top-left cell. Null for a non-diagonal segment. The two diagonals
 * of one block share this key — R4 makes them mutually exclusive.
 */
export function diagonalBlockKey(a: Cell, b: Cell): string | null {
  if (!isDiagonal(a, b)) return null;
  return `${Math.min(a.col, b.col)},${Math.min(a.row, b.row)}`;
}

/** The k-1 segments of one beam, in drawn order. */
export function beamSegments(beam: readonly Cell[]): Array<[Cell, Cell]> {
  const segs: Array<[Cell, Cell]> = [];
  for (let i = 0; i + 1 < beam.length; i++) {
    const a = beam[i];
    const b = beam[i + 1];
    if (a !== undefined && b !== undefined) segs.push([a, b]);
  }
  return segs;
}

/** Every segment drawn on the board, across every beam. */
export function allSegments(
  beams: Beams,
): Array<{ channel: Channel; a: Cell; b: Cell }> {
  const out: Array<{ channel: Channel; a: Cell; b: Cell }> = [];
  for (const ch of CHANNELS) {
    const beam = beams[ch];
    if (!beam) continue;
    for (const [a, b] of beamSegments(beam)) out.push({ channel: ch, a, b });
  }
  return out;
}

/** Set of normalized keys of every drawn segment (R3's ledger). */
export function usedSegmentKeys(beams: Beams): Set<string> {
  const set = new Set<string>();
  for (const { a, b } of allSegments(beams)) set.add(segmentKey(a, b));
  return set;
}

/** Set of 2x2 block keys that already carry a diagonal (R4's ledger). */
export function usedDiagonalBlocks(beams: Beams): Set<string> {
  const set = new Set<string>();
  for (const { a, b } of allSegments(beams)) {
    const bk = diagonalBlockKey(a, b);
    if (bk !== null) set.add(bk);
  }
  return set;
}

/** Number of drawn segments meeting the given cell, across every beam. */
export function incidentSegments(beams: Beams, cell: Cell): number {
  let n = 0;
  for (const { a, b } of allSegments(beams)) {
    if (sameCell(a, cell)) n++;
    if (sameCell(b, cell)) n++;
  }
  return n;
}

/**
 * How many charges of the crystal at `cell` are spent. Per R5, a charge is
 * spent on entry: every occurrence of the crystal in a beam that carries at
 * least one segment is one entry (an interior occurrence is a completed
 * crossing; an occurrence at a beam end is a crossing begun and not yet
 * completed, its charge already spent). A single-cell beam carries no
 * segment and spends nothing.
 */
export function crystalEntries(beams: Beams, cell: Cell): number {
  let entries = 0;
  for (const ch of CHANNELS) {
    const beam = beams[ch];
    if (!beam || beam.length < 2) continue;
    for (const c of beam) if (sameCell(c, cell)) entries++;
  }
  return entries;
}

/** True when some beam of two or more cells begins or ends on `cell` (a crossing begun, not completed). */
export function hasIncompleteCrossing(beams: Beams, cell: Cell): boolean {
  for (const ch of CHANNELS) {
    const beam = beams[ch];
    if (!beam || beam.length < 2) continue;
    const first = beam[0];
    const last = beam[beam.length - 1];
    if ((first && sameCell(first, cell)) || (last && sameCell(last, cell)))
      return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// The limits — R1..R5, checked on every move.
// ---------------------------------------------------------------------------

/**
 * Check the move that would extend `channel`'s beam from its live end (the
 * beam's last cell) to `to`. Returns {ok: true} when every limit permits it,
 * or the first limit (in R1..R5 order) that refuses it. The spec fixes no
 * reporting order — it only says a move breaking a limit is refused — so the
 * numeric order here is a library convention; scenarios asserting a specific
 * rule should pose exactly one violation.
 *
 * Throws if the channel has no live beam to extend (a trace-level precondition
 * from specs/controls.md, not a beam rule).
 */
export function checkMove(
  board: Board,
  beams: Beams,
  channel: Channel,
  to: Cell,
): MoveVerdict {
  const beam = beams[channel];
  const from = beam?.[beam.length - 1];
  if (!beam || beam.length === 0 || from === undefined) {
    throw new Error(`channel ${channel} has no live beam to extend`);
  }

  const fromNode = nodeAt(board, from.col, from.row);
  const toNode = nodeAt(board, to.col, to.row);

  // R1 Adjacency: a segment joins two nodes 8-adjacent and distinct; empty
  // cells hold no node and are never part of a beam.
  if (fromNode === undefined) {
    return {
      ok: false,
      rule: "R1",
      reason: `live end (${from.col}, ${from.row}) holds no node`,
    };
  }
  if (toNode === undefined) {
    return {
      ok: false,
      rule: "R1",
      reason: `target cell (${to.col}, ${to.row}) holds no node`,
    };
  }
  if (!isAdjacent(from, to)) {
    return {
      ok: false,
      rule: "R1",
      reason: `(${from.col}, ${from.row}) and (${to.col}, ${to.row}) are not 8-adjacent distinct cells`,
    };
  }

  // R2 Exclusion: a beam never meets an emitter or a lens of another channel.
  if (toNode.kind !== "crystal" && toNode.channel !== channel) {
    return {
      ok: false,
      rule: "R2",
      reason: `target is a ${toNode.kind} of channel ${toNode.channel ?? "none"}, not ${channel}`,
    };
  }

  // R3 Segment exclusivity: each segment carries at most one beam, used at most once.
  if (usedSegmentKeys(beams).has(segmentKey(from, to))) {
    return { ok: false, rule: "R3", reason: "segment already carries a beam" };
  }

  // R4 Diagonal exclusivity: at most one of the two diagonals of any 2x2 block.
  const bk = diagonalBlockKey(from, to);
  if (bk !== null && usedDiagonalBlocks(beams).has(bk)) {
    return {
      ok: false,
      rule: "R4",
      reason: `a diagonal of the 2x2 block at (${bk}) is already part of a beam`,
    };
  }

  // R5 Capacity.
  if (toNode.kind === "emitter" && incidentSegments(beams, to) >= 1) {
    return {
      ok: false,
      rule: "R5",
      reason: "an emitter carries at most one segment",
    };
  }
  if (fromNode.kind === "emitter" && incidentSegments(beams, from) >= 1) {
    return {
      ok: false,
      rule: "R5",
      reason: "an emitter carries at most one segment",
    };
  }
  if (toNode.kind === "lens" && incidentSegments(beams, to) >= 2) {
    return {
      ok: false,
      rule: "R5",
      reason: "a lens carries at most two segments of its own channel",
    };
  }
  if (fromNode.kind === "lens" && incidentSegments(beams, from) >= 2) {
    return {
      ok: false,
      rule: "R5",
      reason: "a lens carries at most two segments of its own channel",
    };
  }
  if (toNode.kind === "crystal") {
    const charges = toNode.charges ?? 0;
    if (crystalEntries(beams, to) >= charges) {
      return {
        ok: false,
        rule: "R5",
        reason: "a move into a crystal whose charges are all spent is refused",
      };
    }
  }

  return { ok: true };
}

/**
 * Apply a checked move: returns a new Beams with `to` appended to the
 * channel's beam. Call checkMove first; this applies unconditionally.
 */
export function applyMove(beams: Beams, channel: Channel, to: Cell): Beams {
  const beam = beams[channel] ?? [];
  return { ...beams, [channel]: [...beam, { col: to.col, row: to.row }] };
}

// ---------------------------------------------------------------------------
// Completion — R6..R9, never used to refuse a move.
// ---------------------------------------------------------------------------

/**
 * R6 Endpoints: the channel's beam runs between that channel's two emitters,
 * with exactly one segment meeting each.
 */
export function r6Endpoints(
  board: Board,
  beams: Beams,
  channel: Channel,
): boolean {
  const beam = beams[channel];
  if (!beam || beam.length < 2) return false;
  const emitters = emittersOf(board, channel);
  if (emitters.length !== 2) return false;
  const [ea, eb] = emitters;
  if (ea === undefined || eb === undefined) return false;
  const first = beam[0];
  const last = beam[beam.length - 1];
  if (first === undefined || last === undefined) return false;
  const spansBoth =
    (sameCell(first, ea) && sameCell(last, eb)) ||
    (sameCell(first, eb) && sameCell(last, ea));
  if (!spansBoth) return false;
  return incidentSegments(beams, ea) === 1 && incidentSegments(beams, eb) === 1;
}

/**
 * R7 Coverage: every lens of the channel carries exactly two of its segments —
 * the beam enters it once and leaves it once; none is left unvisited.
 */
export function r7Coverage(
  board: Board,
  beams: Beams,
  channel: Channel,
): boolean {
  return lensesOf(board, channel).every(
    (lens) => incidentSegments(beams, { col: lens.col, row: lens.row }) === 2,
  );
}

/** A channel's beam is complete when R6 and R7 both hold of it. */
export function beamComplete(
  board: Board,
  beams: Beams,
  channel: Channel,
): boolean {
  return (
    r6Endpoints(board, beams, channel) && r7Coverage(board, beams, channel)
  );
}

/**
 * R8 Crystals: a crystal is satisfied when all of its charges are spent and
 * every crossing begun across it has been completed (no beam ends on it).
 */
export function r8CrystalSatisfied(
  board: Board,
  beams: Beams,
  cell: Cell,
): boolean {
  const node = nodeAt(board, cell.col, cell.row);
  if (node === undefined || node.kind !== "crystal") {
    throw new Error(`no crystal at (${cell.col}, ${cell.row})`);
  }
  const charges = node.charges ?? 0;
  return (
    crystalEntries(beams, cell) === charges &&
    !hasIncompleteCrossing(beams, cell)
  );
}

/**
 * R9 Solved: R6 and R7 hold for every channel present, and R8 holds for every
 * crystal on the board.
 */
export function r9Solved(board: Board, beams: Beams): boolean {
  for (const ch of channelsPresent(board)) {
    if (!beamComplete(board, beams, ch)) return false;
  }
  for (const crystal of crystalsOf(board)) {
    if (
      !r8CrystalSatisfied(board, beams, { col: crystal.col, row: crystal.row })
    )
      return false;
  }
  return true;
}
