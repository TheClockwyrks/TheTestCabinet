// Orrery — the machine as data: building a part, copying a machine, and the
// tapes (specs/state.md `PartState`, specs/instructions.md "Tapes and the
// period", specs/formats.md).
//
// A machine is `editor.parts`: placed parts in placement order, which is also
// the tape panel's row order. Everything derived from it — the cost, the
// period, which rows the tape panel shows — is derived here or in
// `src/parts.ts` and never stored, so there is one machine and no second copy
// of it to fall out of step.
//
// The undo history holds machines, so a deep copy is a first-class operation:
// an entry must not share an array with the machine it was taken from, or
// undoing would restore what it had already lost.

import { ARM_MIN_LEN } from "./constants";
import { carriesTape, partClass } from "./parts";
import type { Hex, Instruction, PartKind, PartState, TapeCell } from "./types";

/** What a newly placed part of `kind` needs beyond its kind and its pose. */
export interface PartOptions {
  /** The rest length, for an arm or piston. */
  length?: number;
  /** The path, for a track. */
  cells?: readonly Hex[];
  /** The loop flag, for a track. */
  closed?: boolean;
  /** Which reagent or product, for a rise or set. */
  index?: number;
  /** The tape, for an arm or wheel. */
  tape?: readonly TapeCell[];
}

/**
 * One placed part, with every field its class does not use resting at `null`
 * and every field it does use at the value a fresh placement carries: length
 * `ARM_MIN_LEN`, an empty tape, a one-cell open path.
 */
export function createPart(
  id: number,
  kind: PartKind,
  q: number,
  r: number,
  rotation: number,
  options: PartOptions = {},
): PartState {
  const cls = partClass(kind);
  const track = cls === "track";
  const cells = track ? [...(options.cells ?? [{ q, r }])].map(copyHex) : null;
  return {
    id,
    kind,
    // A track's anchor mirrors the first cell of its path.
    q: track && cells !== null && cells.length > 0 ? cells[0].q : q,
    r: track && cells !== null && cells.length > 0 ? cells[0].r : r,
    rotation: track ? 0 : rotation,
    length: cls === "arm" ? (options.length ?? ARM_MIN_LEN) : ARM_MIN_LEN,
    cells,
    closed: track ? (options.closed ?? false) : null,
    index: cls === "rise" || cls === "set" ? (options.index ?? 0) : null,
    tape: carriesTape(kind) ? trimTape(options.tape ?? []) : null,
  };
}

/** A hex copied, so no two structures share one. */
export function copyHex(cell: Hex): Hex {
  return { q: cell.q, r: cell.r };
}

/** One part copied, sharing nothing with the original. */
export function clonePart(part: PartState): PartState {
  return {
    ...part,
    cells: part.cells === null ? null : part.cells.map(copyHex),
    tape: part.tape === null ? null : [...part.tape],
  };
}

/** A whole machine copied, sharing nothing with the original. */
export function cloneMachine(parts: readonly PartState[]): PartState[] {
  return parts.map(clonePart);
}

/**
 * A tape with its trailing blanks removed: the last entry is never `null`, and
 * an entirely blank tape is the empty array (specs/formats.md).
 */
export function trimTape(cells: readonly TapeCell[]): TapeCell[] {
  const trimmed = [...cells];
  while (trimmed.length > 0 && trimmed[trimmed.length - 1] === null) {
    trimmed.pop();
  }
  return trimmed;
}

/**
 * A tape's length: the index of its last non-blank cell plus one, and `0` when
 * it is entirely blank. Tapes are stored trimmed, so this is their length.
 */
export function tapeLength(tape: readonly TapeCell[] | null): number {
  return trimTape(tape ?? []).length;
}

/**
 * The machine's period `P`: the largest tape length across its arms and
 * wheels, and `1` when every tape is empty (specs/instructions.md).
 */
export function machinePeriod(parts: readonly PartState[]): number {
  let longest = 0;
  for (const part of parts) {
    if (!carriesTape(part.kind)) continue;
    longest = Math.max(longest, tapeLength(part.tape));
  }
  return longest === 0 ? 1 : longest;
}

/**
 * The cell a part executes on cycle `c`: index `c mod P` of its own tape, and
 * a blank for a cell at or past the tape's own length.
 */
export function tapeCellAt(
  tape: readonly TapeCell[] | null,
  cycle: number,
  period: number,
): TapeCell {
  if (tape === null || period <= 0) return null;
  const index = ((cycle % period) + period) % period;
  return tape[index] ?? null;
}

/**
 * A tape with `instruction` written at `col`. Cells between the tape's end and
 * `col` become blanks, and the trimming rule is applied afterwards
 * (specs/instrumentation.md `setTapeCell`).
 */
export function writeTapeCell(
  tape: readonly TapeCell[] | null,
  col: number,
  instruction: Instruction | null,
): TapeCell[] {
  const cells: TapeCell[] = [...(tape ?? [])];
  while (cells.length <= col) cells.push(null);
  cells[col] = instruction;
  return trimTape(cells);
}

/** The arms and wheels of a machine, in placement order: the tape panel's rows. */
export function tapeRows(parts: readonly PartState[]): PartState[] {
  return parts.filter((part) => carriesTape(part.kind));
}

/** A part of the machine, by `id`, or `null` when nothing carries that id. */
export function findPart(
  parts: readonly PartState[],
  id: number,
): PartState | null {
  return parts.find((part) => part.id === id) ?? null;
}

/** Which tape-panel row a part occupies, or `-1` when it carries no row. */
export function tapeRowIndex(parts: readonly PartState[], id: number): number {
  return tapeRows(parts).findIndex((part) => part.id === id);
}
