// editor/row-labels-are-drawn-distinguishably — no two of a machine's row labels
// are the same picture, and a row's label is not what a vacant row draws.
//
// THE RULE. "Each row's label carries an identifier unique among the machine's
// rows, and the same identifier is drawn on that part on the field"
// (`specs/editor.md`, The tape panel). An identifier that is unique among the rows
// and drawn on each of them cannot be drawn the same way twice, and an identifier
// that is drawn at all leaves its row's label carrying something.
//
// WHERE A LABEL IS. The same section fixes the rectangle: "A row's label spans `x`
// `TRAY_REGION_W` (`224`) to `TRAY_REGION_W + TAPE_LABEL_W` (`304`) across its
// row's full height", and a row spans "`y` `TAPE_Y0 + v * TAPE_ROW_H` to `TAPE_Y0 +
// (v + 1) * TAPE_ROW_H`".
//
// THREE ROWS ARE READ IN ONE RECTANGLE, NOT THREE RECTANGLES IN ONE FRAME. Nothing
// in `specs/` fixes what a build draws around a row — a band, a rule, a stripe by
// parity, the panel's own border along its first row — so two labels read at two
// different `y` may differ for reasons that are not the identifier, and comparing
// them would decide nothing. Instead ONE rectangle is read three times, with the
// panel scrolled so that a different row stands in it each time: "Visible row `v`
// ... shows the arm at index `firstRow + v`", and `firstRow` is
// `max(0, selectedRow - 4)`. With SEVEN arms placed and the cursor moved between
// the arms at indices `4`, `5` and `6`, `firstRow` is `0`, `1` and `2`, so visible
// row `0` shows the arms at indices `0`, `1` and `2` in turn. Everything else about
// that rectangle holds still: the same `y`, the same panel, the same focus, and the
// cursor's own row is visible row `4` in all three, since `firstRow + 4` is the
// cursor's row every time.
//
// THE ANNOTATION IS HELD STILL TOO. Every tape is left blank, so every row's
// length is `0` and the machine's period is `1`, and the annotation
// `specs/editor.md` requires beside the identifier reads the same on all three.
// What is left to tell the three pictures apart is the identifier.
//
// WHAT "NOT DRAWN EMPTY" IS MEASURED AGAINST, IN ONE RECTANGLE TOO. With THREE
// arms placed and no cursor, visible row `2` holds the third of them; that arm is
// then removed and the SAME rectangle is read again, where visible row `2` now
// holds no row. Nothing about the rectangle moved — the same `x`, the same `y`,
// the same panel — so what the two pictures can differ by is the identifier a row
// puts there, rather than a colour this check guessed at.
//
// THE VERDICT. The three pictures of visible row `0`'s label are pairwise
// different, and one rectangle draws something where a row stands that it does not
// draw where none does.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { at, tapeLabel, type Hex } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  clearWorld,
  createHarness,
  openChallengeDocument,
  pixelsDiffering,
  placePart,
  type Harness,
  type PixelRect,
} from "../harness";

/** Seven anchors on one row of the field, `max(|q|, |r|, |q + r|) <= FIELD_R` (`5`). */
const SEVEN: readonly Hex[] = [-3, -2, -1, 0, 1, 2, 3].map((q) => at(q, 0));

/** Three anchors, for the frame that shows an occupied row beside a vacant one. */
const THREE: readonly Hex[] = [at(-3, 0), at(0, 0), at(3, 0)];

/** The rows read in visible row 0, one per scroll position. */
const ROWS_READ = [0, 1, 2] as const;

/** The visible row read twice: it holds the third arm, and then no row at all. */
const OCCUPIED_ROW = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

function readLabel(v: number): Promise<PixelRect> {
  const label = tapeLabel(v);
  return h.pixelRect(label.x, label.y, label.w, label.h);
}

it("draws a different label for each row, and none of them blank", async () => {
  await openChallengeDocument(h, BARE);
  const arms: number[] = [];
  for (const anchor of SEVEN) arms.push(await placePart(h, "arm", anchor));
  assertEqual(
    (await h.snapshot()).editor.parts.length,
    SEVEN.length,
    "the machine is the seven arms and nothing else, so editor.parts's order is the panel's row order",
  );

  const labels: PixelRect[] = [];
  for (const row of ROWS_READ) {
    // firstRow is max(0, (row + 4) - 4), which is `row`, so visible row 0 is it.
    await h.debug.setCursor(arms[row + 4] as number, 0);
    await h.advance(1);
    if (row === 0) await captureStill(h, "labels");
    labels.push(await readLabel(0));
  }

  for (const [a, rowA] of ROWS_READ.entries()) {
    for (let b = a + 1; b < ROWS_READ.length; b += 1) {
      assertGreaterThan(
        pixelsDiffering(labels[a] as PixelRect, labels[b] as PixelRect),
        0,
        `rows ${rowA} and ${ROWS_READ[b]} carry identifiers unique among the machine's rows, so the same rectangle does not draw them alike`,
      );
    }
  }

  await clearWorld(h);
  const three: number[] = [];
  for (const anchor of THREE) three.push(await placePart(h, "arm", anchor));
  await h.debug.setCursor(null, 0);
  await h.advance(1);

  assertEqual(
    (await h.snapshot()).editor.parts.length,
    THREE.length,
    "the machine is now three arms, so visible row 2 holds the last of them",
  );
  const occupied = await readLabel(OCCUPIED_ROW);

  await h.debug.removePart(three[THREE.length - 1] as number);
  await h.advance(1);
  assertEqual(
    (await h.snapshot()).editor.parts.length,
    THREE.length - 1,
    "the machine is now two arms, so visible row 2 holds no row at all",
  );
  const vacant = await readLabel(OCCUPIED_ROW);

  assertGreaterThan(
    pixelsDiffering(occupied, vacant),
    0,
    `visible row ${OCCUPIED_ROW}'s label carries its row's identifier, so that one rectangle is drawn differently with a row standing in it than with none`,
  );
});
