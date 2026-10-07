// Orrery — writing a tape by hand.
//
// A reference solution's tapes are long and mostly repetition: a run of the
// same rotation, a stretch of blanks while another part does the work. Written
// out cell by cell they would be unreadable and their offsets impossible to
// check by eye, so `src/solutions.extras.ts` and `src/solutions.campaign.ts`
// write them as runs and rests instead.

import type { Instruction, TapeCell } from "./types";

/** `n` copies of one instruction, for a tape written as runs. */
export function run(n: number, instruction: Instruction): TapeCell[] {
  return Array.from({ length: n }, () => instruction);
}

/** `n` blank cells: the rest a part holds while another does the work. */
export function rest(n: number): TapeCell[] {
  return Array.from({ length: n }, () => null);
}

/** One tape, written as a sequence of runs and single cells. */
export function tape(...pieces: (TapeCell | TapeCell[])[]): TapeCell[] {
  return pieces.flat();
}
