// Orrery — the two editor macros, `reset` and `repeat`
// (specs/instructions.md "The two macros").
//
// Neither is an instruction: invoking one writes PLAIN INSTRUCTIONS into the
// tape at the cursor, so a tape a macro wrote is a tape a player could have
// typed. Both are computed from the arm's own tape alone, so what any other
// part of the machine carries changes nothing.
//
// `reset` walks the arm's pose forward through the cells before the cursor and
// then writes the run that returns it. The WALK is a pose simulation with the
// run's consequences deliberately removed: it ignores faults and other parts,
// clamps a length at the bounds instead of faulting, and stops at the end of
// an open track instead of faulting — so the expansion is always writable,
// whatever the tape in front of it would do to a real run.
//
// `repeat` copies the cells before the cursor, blanks included, so the copy is
// the prefix cell for cell rather than its instructions closed up.

import { ARM_MAX_LEN, ARM_MIN_LEN } from "./constants";
import { sameHex, wrapDir } from "./hex";
import type { Instruction, PartState, TapeCell } from "./types";

/** The pose the walk reached: the three things a `reset` run has to undo. */
export interface ArmWalk {
  /** The spoke direction the arm's first spoke stands on. */
  readonly rotation: number;
  /** The arm's length. */
  readonly length: number;
  /** Which cell of its track the base stands on, and `-1` when unmounted. */
  readonly cell: number;
}

/** Where a track's path stands, for the walk and for the run it writes. */
export interface TrackPath {
  /** The path, in order. */
  readonly cells: readonly { q: number; r: number }[];
  /** Whether the ends are joined into a loop. */
  readonly closed: boolean;
}

/** The rest pose a part was placed at, which every walk starts from. */
export function restWalk(part: PartState, track: TrackPath | null): ArmWalk {
  return {
    rotation: part.rotation,
    length: part.length,
    cell:
      track === null
        ? -1
        : track.cells.findIndex((cell) =>
            sameHex(cell, { q: part.q, r: part.r }),
          ),
  };
}

/** One cell of a track path stepped forward, or back, as the walk steps it. */
function stepCell(
  at: number,
  track: TrackPath | null,
  forward: boolean,
): number {
  if (track === null || at < 0) return at;
  const count = track.cells.length;
  if (count === 0) return -1;
  if (track.closed) {
    return forward ? (at + 1) % count : (at + count - 1) % count;
  }
  return forward ? Math.min(count - 1, at + 1) : Math.max(0, at - 1);
}

/**
 * The pose reached by executing the tape's cells `0` up to `col` once from the
 * rest pose, ignoring faults and other parts (specs/instructions.md).
 */
export function walkTape(
  part: PartState,
  track: TrackPath | null,
  col: number,
): ArmWalk {
  const tape = part.tape ?? [];
  let { rotation, length, cell } = restWalk(part, track);
  for (let i = 0; i < col; i += 1) {
    switch (tape[i] ?? null) {
      case "rotate-cw":
        rotation = wrapDir(rotation + 1);
        break;
      case "rotate-ccw":
        rotation = wrapDir(rotation - 1);
        break;
      case "extend":
        length = Math.min(ARM_MAX_LEN, length + 1);
        break;
      case "retract":
        length = Math.max(ARM_MIN_LEN, length - 1);
        break;
      case "advance":
        cell = stepCell(cell, track, true);
        break;
      case "recede":
        cell = stepCell(cell, track, false);
        break;
      default:
        break;
    }
  }
  return { rotation, length, cell };
}

/** The rotation run from `from` back to `to`, the shorter way, ties clockwise. */
export function rotationRun(from: number, to: number): Instruction[] {
  const clockwise = wrapDir(to - from);
  const counter = wrapDir(from - to);
  if (clockwise === 0) return [];
  const useCounter = counter < clockwise;
  const steps = useCounter ? counter : clockwise;
  return Array.from<Instruction>({ length: steps }).fill(
    useCounter ? "rotate-ccw" : "rotate-cw",
  );
}

/** The length run from `from` back to `to`: retracts above, extends below. */
export function lengthRun(from: number, to: number): Instruction[] {
  const steps = Math.abs(from - to);
  return Array.from<Instruction>({ length: steps }).fill(
    from > to ? "retract" : "extend",
  );
}

/**
 * The track run from cell `from` back to cell `to`, the shorter way, ties
 * `advance`. A closed track counts each direction through the join; an open
 * one counts along the path alone, so exactly one direction reaches at all.
 */
export function trackRun(
  from: number,
  to: number,
  track: TrackPath | null,
): Instruction[] {
  if (track === null || from < 0 || to < 0 || from === to) return [];
  const count = track.cells.length;
  const forward = track.closed ? wrapDir0(to - from, count) : to - from;
  const back = track.closed ? wrapDir0(from - to, count) : from - to;
  if (forward >= 0 && (back < 0 || forward <= back)) {
    return Array.from<Instruction>({ length: forward }).fill("advance");
  }
  return Array.from<Instruction>({ length: back }).fill("recede");
}

/** A step count brought into `0` to `count - 1`, for a closed track's join. */
function wrapDir0(value: number, count: number): number {
  return ((value % count) + count) % count;
}

/**
 * What `reset` writes when it is invoked at `col` of `part`'s tape: `drop`,
 * the length run, the rotation run, and the track run, in that order. A wheel
 * receives the rotation run alone, and an arm already at rest receives `drop`
 * alone.
 */
export function resetExpansion(
  part: PartState,
  track: TrackPath | null,
  col: number,
): Instruction[] {
  const walk = walkTape(part, track, col);
  const rest = restWalk(part, track);
  const rotation = rotationRun(walk.rotation, rest.rotation);
  if (part.kind === "wheel") return rotation;
  return [
    "drop",
    ...lengthRun(walk.length, rest.length),
    ...rotation,
    ...trackRun(walk.cell, rest.cell, track),
  ];
}

/**
 * What `repeat` writes when it is invoked at `col`: the tape's cells `0` up to
 * but not including `col`, blanks included, and a cell at or past the tape's
 * own length copied as a blank. Invoked at cell `0` it writes nothing.
 */
export function repeatExpansion(part: PartState, col: number): TapeCell[] {
  const tape = part.tape ?? [];
  return Array.from(
    { length: Math.max(0, col) },
    (_unused, i) => tape[i] ?? null,
  );
}
