// editor/a-blank-cell-is-drawn-empty — a blank cell carries no glyph, and a column
// past the tape's end carries none either.
//
// THE RULE. "Each cell shows its instruction as the produced glyph
// `specs/assets.md` names for it, drawn at native size, with the ten instructions
// of `specs/instructions.md` distinguishable at `TAPE_CELL_W` (`24`); a blank cell
// is drawn empty" (`specs/editor.md`, The tape panel). The sentence sets a written
// cell against a blank one: the first shows a glyph and the second shows none.
// `specs/assets.md` says where such a glyph lands — the instruction glyphs are
// "`24 x 24`", "centered in its tape cell" — so a cell showing its instruction has
// a mark of its own centred in it, and a cell drawn empty has not.
//
// A COLUMN PAST THE TAPE'S END IS A BLANK CELL TOO. `specs/instructions.md`: "a
// cell at or past the tape's own length is blank." So the same clause governs it,
// and it is read the same way.
//
// WHAT IS NOT READ. No sentence of `specs/` fixes the chrome a build draws around a
// cell rectangle — its border, its ground, any mark of where a tape ends — so the
// verdict is taken over what is drawn INSIDE the cell rather than over the
// rectangle pixel for pixel. "Drawn empty" is decided as the specification words
// it: the cell carries no glyph of its own.
//
// THE CONFIGURATION. `BARE` opened in the editor with ONE arm and nothing else, so
// the panel has exactly one row. Its tape is `grab`, a blank, `grab` — a blank cell
// between two written ones — which makes the tape's length `3`, so visible columns
// `0` and `2` are written, `1` is a blank inside the tape, and `5` is past its end.
// The cursor is cleared, so no cell is marked as the cursor's and `firstRow` and
// `firstCol` are both `0`; the four rectangles read are therefore the unscrolled
// ones `specs/editor.md` fixes.
//
// THE VERDICT. Each written cell carries a mark of its own — an image centred
// inside it, or a run of text anchored inside it — and neither the blank cell nor
// the column past the tape's end carries either.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { TAPE_CELL_W } from "../constants";
import { regionCenter, tapeCell, type Region } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  imagesNear,
  openChallengeDocument,
  placePart,
  textIn,
  writeTape,
  type DrawCall,
  type Harness,
} from "../harness";

/** The tape written: a blank cell between two written ones, so its length is 3. */
const TAPE = ["grab", null, "grab"] as const;

/** A column past that tape's end, which `specs/instructions.md` makes blank. */
const PAST_THE_END = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * How many marks of its own a cell carries: images centred inside it, plus runs of
 * text anchored inside it.
 *
 * The radius is half a cell, so a glyph centred in a neighbouring cell — `TAPE_CELL_W`
 * (`24`) away — is that neighbour's mark rather than this one's.
 */
function marksIn(calls: readonly DrawCall[], cell: Region): number {
  return (
    imagesNear(calls, regionCenter(cell), TAPE_CELL_W / 2).length +
    textIn(calls, cell).length
  );
}

it("draws a glyph in each written cell and nothing in the blank ones", async () => {
  await openChallengeDocument(h, BARE);
  const arm = await placePart(h, "arm", ORIGIN);
  await writeTape(h, arm, TAPE);
  await h.debug.setCursor(null, 0);
  await h.advance(1);
  await captureStill(h, "blank");

  assertEqual(
    (await h.snapshot()).editor.parts[0]?.tape?.length,
    TAPE.length,
    "the tape's length is the index of its last non-blank cell plus one, which is 3",
  );

  const calls = await h.lastCalls();

  assertGreaterThan(
    marksIn(calls, tapeCell(0, 0)),
    0,
    "cell 0 holds grab, so it shows that instruction's glyph",
  );
  assertGreaterThan(
    marksIn(calls, tapeCell(0, 2)),
    0,
    "cell 2 holds grab, so it shows that instruction's glyph too",
  );
  assertEqual(
    marksIn(calls, tapeCell(0, 1)),
    0,
    "cell 1 is blank, and a blank cell is drawn empty: it carries no glyph of its own",
  );
  assertEqual(
    marksIn(calls, tapeCell(0, PAST_THE_END)),
    0,
    `column ${PAST_THE_END} is past the tape's end, which is blank, so it carries no glyph either`,
  );
});
