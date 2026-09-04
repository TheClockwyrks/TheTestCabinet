// editor/a-row-is-annotated-with-its-tape-length — a row's annotation follows both
// of the two figures it states.
//
// THE RULE. "The cursor's cell is visibly marked, and each row is annotated with
// its tape length against the machine's period" (`specs/editor.md`, The tape
// panel). Two figures, and the annotation is of one against the other, so it moves
// when either moves. The figures are `specs/instructions.md`'s: "A tape's length is
// the index of its last non-blank cell plus one, and `0` when it is entirely
// blank", and "The machine's period `P` is the largest tape length across its arms
// and wheels".
//
// HOW IT IS READ. A row's rectangle, drawn three times, with exactly one of the two
// figures moved between each pair. Where inside the row a build puts the annotation
// is the build's, so the whole row is read: `x` `TRAY_REGION_W` (`224`) to `STAGE_W`
// (`1280`), across "`y` `TAPE_Y0 + v * TAPE_ROW_H` to `TAPE_Y0 + (v + 1) *
// TAPE_ROW_H`".
//
// THE CONFIGURATION. `BARE` opened in the editor with TWO arms and nothing else, so
// the panel has two rows and the first arm's is visible row `0`. The cursor is
// cleared, which puts `firstRow` and `firstCol` at `0` and leaves no cell marked as
// the cursor's. The SECOND arm's tape is given a `grab` at column `59`, making its
// length `60`, and the first's a `grab` at column `45`, making its length `46`. The
// period is the larger, `60`.
//
// NEITHER MOVE TOUCHES A VISIBLE CELL, which is what makes the reading the
// annotation's. Only forty columns are on show and `firstCol` is `0`, so visible
// columns `0` to `39` are what row `0`'s rectangle holds — and the first arm's cells
// `0` to `39` are blank in every one of the three frames, and inside its tape in
// every one of them, since its length is never below `46`. Every write below lands
// at column `45` or beyond.
//
// THE TWO MOVES. First the first arm's own tape lengthens, `46` to `50`, with the
// period left at `60` because the second arm's tape is longer than both: a build
// annotating the period alone would draw row `0` unchanged. Then the second arm's
// tape lengthens, `60` to `70`, raising the period while the first arm's length
// stands at `50`: a build annotating its own length alone would draw row `0`
// unchanged. Only a row showing its length AGAINST the period redraws for both.
//
// THE VERDICT. Row `0`'s rectangle changes across each of the two moves.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNull } from "../assert";
import {
  STAGE_W,
  TAPE_COLS_VISIBLE,
  TAPE_ROW_H,
  TAPE_Y0,
  TRAY_REGION_W,
} from "../constants";
import { at } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  pixelsDiffering,
  placePart,
  type Harness,
  type PixelRect,
} from "../harness";

/** The two anchors the two arms stand on, six hexes apart and both on the field. */
const FIRST = at(-3, 0);
const SECOND = at(3, 0);

/** The first arm's tape lengths, before and after its own move: 46 then 50. */
const OWN_LENGTHS = [46, 50] as const;

/** The second arm's tape lengths, which set the period: 60 then 70. */
const OTHER_LENGTHS = [60, 70] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Visible row `v`'s rectangle: the panel's full width across that row's height. */
function readRow(v: number): Promise<PixelRect> {
  return h.pixelRect(
    TRAY_REGION_W,
    TAPE_Y0 + v * TAPE_ROW_H,
    STAGE_W - TRAY_REGION_W,
    TAPE_ROW_H,
  );
}

/** Read row 0 back, having first checked the two figures and the visible cells. */
async function frame(
  first: number,
  ownLength: number,
  period: number,
): Promise<PixelRect> {
  await h.advance(1);
  const editor = (await h.snapshot()).editor;
  const arm = editor.parts.find((part) => part.id === first);
  assertEqual(
    arm?.tape?.length,
    ownLength,
    `the first arm's tape length is ${ownLength}`,
  );
  assertEqual(editor.period, period, `the machine's period is ${period}`);
  for (let col = 0; col < TAPE_COLS_VISIBLE; col += 1) {
    assertNull(
      arm?.tape?.[col] ?? null,
      `the first arm's cell ${col} is blank, so none of the forty visible columns carries a glyph`,
    );
  }
  return readRow(0);
}

it("redraws the row when its own tape lengthens and when the period rises", async () => {
  await openChallengeDocument(h, BARE);
  const first = await placePart(h, "arm", FIRST);
  const second = await placePart(h, "arm", SECOND);
  await h.debug.setCursor(null, 0);

  await h.debug.setTapeCell(second, OTHER_LENGTHS[0] - 1, "grab");
  await h.debug.setTapeCell(first, OWN_LENGTHS[0] - 1, "grab");
  const before = await frame(first, OWN_LENGTHS[0], OTHER_LENGTHS[0]);

  await h.debug.setTapeCell(first, OWN_LENGTHS[1] - 1, "grab");
  const lengthened = await frame(first, OWN_LENGTHS[1], OTHER_LENGTHS[0]);
  await captureStill(h, "row-annotation");

  await h.debug.setTapeCell(second, OTHER_LENGTHS[1] - 1, "grab");
  const raised = await frame(first, OWN_LENGTHS[1], OTHER_LENGTHS[1]);

  assertGreaterThan(
    pixelsDiffering(before, lengthened),
    0,
    `the first arm's tape went from ${OWN_LENGTHS[0]} to ${OWN_LENGTHS[1]} cells with the period unmoved at ${OTHER_LENGTHS[0]}, so its row's annotation changed`,
  );
  assertGreaterThan(
    pixelsDiffering(lengthened, raised),
    0,
    `the period went from ${OTHER_LENGTHS[0]} to ${OTHER_LENGTHS[1]} with the first arm's tape unmoved at ${OWN_LENGTHS[1]} cells, so its row's annotation changed`,
  );
});
