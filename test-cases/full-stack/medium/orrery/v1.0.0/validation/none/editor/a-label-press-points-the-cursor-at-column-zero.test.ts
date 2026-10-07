// editor/a-label-press-points-the-cursor-at-column-zero — a press inside a row's
// label points the cursor at that row, column `0`.
//
// THE RULE, from `specs/editor.md` (The tape panel). "A press inside a row's label
// points [the cursor] at that row, column `0`", over the rectangle the same file
// fixes: "A row's label spans `x` `TRAY_REGION_W` (`224`) to `TRAY_REGION_W +
// TAPE_LABEL_W` (`304`) across its row's full height", where a row's height is
// "`y` `TAPE_Y0 + v * TAPE_ROW_H` to `TAPE_Y0 + (v + 1) * TAPE_ROW_H`". Every
// rectangle this file fixes "includes its lower bound and excludes its upper", so
// `x` `224` is inside and `x` `304` is not, and the row's top `y` is inside and its
// bottom `y` is not.
//
// COLUMN `0` IS THE POINT, and it is not `firstCol`. The cell rule beside it reads
// "Visible column `u` ... shows cell `firstCol + u`", so a build that treated the
// label as a column would land the cursor on `firstCol`. The scroll is therefore
// posed non-zero here: with the cursor at column `50`, `firstCol = max(0, 50 -
// (TAPE_COLS_VISIBLE - 1))` is `11`, so `0` and `firstCol` are different answers
// and the check tells them apart.
//
// THE CONFIGURATION. `BARE` opened in the editor, the machine cleared, and three
// arms placed one at a time through the surface, on `(-3, 0)`, `(0, 0)` and
// `(3, 0)`. Nothing else is on the field. Three rows is fewer than the five the
// panel shows, so `firstRow = max(0, 2 - 4)` is `0` whatever the cursor's row, and
// visible row `1` is the second arm throughout.
//
// FOUR PRESSES, ONE PER CORNER OF THE RECTANGLE AND ONE IN THE MIDDLE: `(224,
// 588)`, the included top-left; `(303, 588)`, the last `x` inside; `(224, 615)`,
// the last `y` inside; and the middle. The cursor is re-posed at the second arm,
// column `50`, before each, so every press is read against the same scroll and
// answers for itself.
//
// THE VERDICT. Every one of the four leaves `editor.cursor` naming the second arm
// at column `0`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { regionCenter, tapeLabel, type StagePoint } from "../field";
import { TAPE_LABEL_W, TAPE_ROW_H, TAPE_Y0, TRAY_REGION_W } from "../constants";
import { BARE, EAST, ORIGIN, WEST } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  placePart,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

/** The visible row pressed, and the column the cursor is posed at before each press. */
const ROW = 1;
const POSED_COL = 50;

/** The four points pressed inside visible row 1's label rectangle. */
const POINTS: readonly { name: string; at: StagePoint }[] = [
  {
    name: "the included top-left corner",
    at: { x: TRAY_REGION_W, y: TAPE_Y0 + ROW * TAPE_ROW_H },
  },
  {
    name: "the last x inside the label",
    at: { x: TRAY_REGION_W + TAPE_LABEL_W - 1, y: TAPE_Y0 + ROW * TAPE_ROW_H },
  },
  {
    name: "the last y inside the row",
    at: { x: TRAY_REGION_W, y: TAPE_Y0 + (ROW + 1) * TAPE_ROW_H - 1 },
  },
  { name: "the middle of the label", at: regionCenter(tapeLabel(ROW)) },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("points the cursor at that row's part and column 0, whatever firstCol is", async () => {
  await openChallengeDocument(h, BARE);
  const arms = [
    await placePart(h, "arm", WEST),
    await placePart(h, "arm", ORIGIN),
    await placePart(h, "arm", EAST),
  ];

  await h.debug.setCursor(arms[1] ?? -1, POSED_COL);
  await h.advance(1);
  await captureStill(h, "cursor");

  for (const point of POINTS) {
    await h.debug.setCursor(arms[1] ?? -1, POSED_COL);
    const posed = (await h.snapshot()).editor.cursor;
    assertEqual(
      posed?.col,
      POSED_COL,
      "the cursor stands at column 50 before the press, so firstCol is 11 and column 0 is a different answer",
    );

    await pressAt(h, point.at);
    await releasePointer(h);
    const cursor = (await h.snapshot()).editor.cursor;

    assertNotNull(cursor, `the press at ${point.name} points the cursor`);
    assertEqual(
      cursor?.part,
      arms[1],
      `the press at ${point.name} points the cursor at that row's part`,
    );
    assertEqual(
      cursor?.col,
      0,
      `the press at ${point.name} points the cursor at column 0 rather than at firstCol`,
    );
  }
});
