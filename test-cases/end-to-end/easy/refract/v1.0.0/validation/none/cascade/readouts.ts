// cascade/readouts — private helpers for the two HUD points, which both read a
// LABELLED NUMBER off the playing frame's text draws: `HUD_SOLVED_LABEL` with
// the boards-solved count adjacent, and `HUD_TIER_LABEL` with the tier's digit
// adjacent (specs/modes/cascade.md "The count"). Private to this category; the
// shared harness files are the harness stage's.
//
// What "adjacent" is read as: the specification fixes the labels and the values
// but deliberately not the layout ("where they sit and how they are styled is
// the build's to design"), so a readout is accepted in either of the two shapes
// a label-and-value pair is drawn in: ONE run carrying both ("SOLVED 3"), or a
// label run with a separate digits run anchored within {@link READOUT_ADJACENCY}
// of it. The radius is two cell pitches (2 x CELL_PITCH = 192, rounded to 200
// logical px): a value drawn further from its label than two whole board cells
// no longer reads as "beside the label" at the stage's logical size.
//
// The draws handed in are the frame's COALESCED runs (the harness's
// `drawnTextRuns`), not its raw `fillText` calls: canvas has no portable
// letter-spacing property, so a build that tracks its HUD draws a glyph per
// call, and a label read off the raw calls would never be found on a build
// that drew exactly the right words.

import { CELL_PITCH } from "../notation";
import { BOARD_EXTENT } from "../constants";
import type { TextDraw } from "../harness";

/** How far a separate value run may sit from its label and still be "beside" it. */
export const READOUT_ADJACENCY = 2 * CELL_PITCH + 8;

/** One labelled readout found on the frame: the label run and the value run. */
export interface Readout {
  label: TextDraw;
  value: TextDraw;
}

/** The whole numbers a run of text carries, in order. */
function numbersIn(text: string): number[] {
  return (text.match(/\d+/g) ?? []).map((digits) =>
    Number.parseInt(digits, 10),
  );
}

/**
 * Every way the frame draws `label` with `value` beside it: the label's own run
 * carrying the number, or a separate run of it anchored within
 * {@link READOUT_ADJACENCY}. Label matching is by substring, ignoring case, the
 * same reading as the harness's `drewText` — the copy is the case's, the
 * presentation the build's.
 */
export function findReadouts(
  draws: readonly TextDraw[],
  label: string,
  value: number,
): Readout[] {
  const wanted = label.trim().toLowerCase();
  const found: Readout[] = [];
  for (const run of draws) {
    if (!run.text.toLowerCase().includes(wanted)) continue;
    if (numbersIn(run.text).includes(value)) {
      found.push({ label: run, value: run });
      continue;
    }
    for (const other of draws) {
      if (other === run) continue;
      if (!numbersIn(other.text).includes(value)) continue;
      if (Math.hypot(other.x - run.x, other.y - run.y) <= READOUT_ADJACENCY) {
        found.push({ label: run, value: other });
      }
    }
  }
  return found;
}

/**
 * Whether a text anchor sits clear of the largest board's extent — outside the
 * box `specs/board.md` puts every cell center in (x 352..928, y 152..632),
 * widened by `NODE_R` (constants.ts `BOARD_EXTENT`).
 */
export function outsideBoardExtent(at: { x: number; y: number }): boolean {
  return (
    at.x < BOARD_EXTENT.x0 ||
    at.x > BOARD_EXTENT.x1 ||
    at.y < BOARD_EXTENT.y0 ||
    at.y > BOARD_EXTENT.y1
  );
}
