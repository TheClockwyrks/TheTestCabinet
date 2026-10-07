// Fathom — the board fixtures this build's own tests are written against.
//
// Every scenario in `src/**/*.test.ts` poses the geometry it is about rather
// than hunting the shipped layout for it, so a test states the shape it depends
// on in its own body. This module is scaffolding for those tests alone; nothing
// the game ships reaches it.

import { GRID_COLS, GRID_ROWS } from "./constants";

/**
 * A full-size board of rock with `rows` stamped into it at `(left, top)`, in the
 * alphabet the snapshot's `tiles` uses. A space stands for rock, so a fixture
 * can be written with the shape it cares about set clear of its surroundings.
 */
export function board(rows: readonly string[], top = 0, left = 0): string[] {
  return stamp(
    Array.from({ length: GRID_ROWS }, () => "#".repeat(GRID_COLS)),
    rows,
    top,
    left,
  );
}

/** The same board with a further shape stamped over it. */
export function stamp(
  base: readonly string[],
  rows: readonly string[],
  top: number,
  left: number,
): string[] {
  return base.map((line, r) => {
    const source = r >= top && r - top < rows.length ? rows[r - top] : "";
    let out = "";
    for (let c = 0; c < GRID_COLS; c++) {
      const ch = c >= left && c - left < source.length ? source[c - left] : "";
      out += ch === "" || ch === " " ? line[c] : ch;
    }
    return out;
  });
}

/**
 * A den sealed on three sides with its single gate above, so a predator posed
 * into it can go no further than the gate however long a scenario runs.
 */
export const SEALED_DEN: readonly string[] = ["#g#", "ddd", "ddd"];
