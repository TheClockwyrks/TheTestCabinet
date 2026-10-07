// editor/heading-press-changes-nothing — the heading is display only, so a press
// anywhere in it leaves the editor's hands exactly as they stand.
//
// THE RULE. `specs/editor.md`'s layout table gives the heading the extent "`x`
// `0` to `STAGE_W` (`1280`), `y` `0` to `HEADING_H` (`48`)", and the sentence
// under the table says what kind of region that is: "The tray, the field, and the
// tape panel are interactive and carry the fixed geometry below. The heading and
// the readout are display only, and their internal layout is yours." A display
// only region carries no interactive geometry, so nothing in the heading selects a
// part, clears a selection, moves the cursor, or begins a drag.
//
// WHAT A PRESS THERE STILL DOES is set the focus: `specs/controls.md` routes
// "a press anywhere else on the editor screen" — anywhere outside the tape panel's
// extent — to `field` focus. That is why the focus is not one of the three
// readings below: the requirement is that the heading holds no geometry, not that
// a press on it is unheard.
//
// THE CONFIGURATION. `BARE` opened in the editor, one arm on the field, that arm
// selected, and the tape cursor pointed at column `2` of its row, so each of the
// three readings carries a value a press could disturb. Four presses, each
// released before the next is made, and each read against that same standing
// state: the middle of the heading; its included top-left corner `(0, 0)`; its
// far interior corner `(STAGE_W - 1, HEADING_H - 1)`; and the point directly above
// the tray's entry column, which is where a build whose tray rectangles ran up
// into the heading would begin a placement.
//
// THE VERDICT. After each of the four, `editor.selected` still names the arm,
// `editor.cursor` still points at column `2` of the arm's row, and `editor.drag`
// is still `null`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { HEADING_H, STAGE_W, TRAY_W, TRAY_X0 } from "../constants";
import { HEADING_REGION, type StagePoint } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  centerOf,
  createHarness,
  openChallengeDocument,
  placePart,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

/** The column of the tape cursor this check parks and then reads back. */
const CURSOR_COL = 2;

/** Four points of the heading's half-open extent, the two corners included. */
const PRESSES: readonly { name: string; at: StagePoint }[] = [
  { name: "the middle of the heading", at: centerOf(HEADING_REGION) },
  { name: "its included top-left corner", at: { x: 0, y: 0 } },
  {
    name: "its far interior corner",
    at: { x: STAGE_W - 1, y: HEADING_H - 1 },
  },
  {
    name: "the point directly above the tray's entry column",
    at: { x: TRAY_X0 + TRAY_W / 2, y: HEADING_H - 1 },
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the selection, the cursor and the drag standing under every heading press", async () => {
  await openChallengeDocument(h, BARE);
  const arm = await placePart(h, "arm", ORIGIN);
  await h.debug.setSelected(arm);
  await h.debug.setCursor(arm, CURSOR_COL);

  const posed = (await h.snapshot()).editor;
  assertEqual(posed.selected, arm, "the arm is selected before any press");
  assertEqual(
    posed.cursor?.part,
    arm,
    "the cursor points at the arm's row before any press",
  );
  assertEqual(
    posed.cursor?.col,
    CURSOR_COL,
    `the cursor sits at column ${CURSOR_COL} before any press`,
  );

  for (const press of PRESSES) {
    await pressAt(h, press.at);
    await h.advance(1);
    await captureStill(h, "heading");

    const editor = (await h.snapshot()).editor;
    assertEqual(
      editor.selected,
      arm,
      `a press at ${press.name} (${press.at.x}, ${press.at.y}) leaves the arm selected`,
    );
    assertEqual(
      editor.cursor?.part,
      arm,
      `that press leaves the cursor on the arm's row`,
    );
    assertEqual(
      editor.cursor?.col,
      CURSOR_COL,
      `that press leaves the cursor at column ${CURSOR_COL}`,
    );
    assertNull(
      editor.drag,
      "that press begins no drag: the heading is display only",
    );

    await releasePointer(h);
  }
});
