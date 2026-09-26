// editor/readout-press-changes-nothing — the readout is display only, so a press
// in it neither clears a selection nor begins a drag.
//
// THE RULE. `specs/editor.md`'s layout table gives the readout the extent "`x`
// `READOUT_X0` (`1008`) to `STAGE_W` (`1280`), `y` `HEADING_H` (`48`) to `TAPE_Y0`
// (`560`)", holding "The run's live figures", and the sentence under the table
// classes it with the heading: "The tray, the field, and the tape panel are
// interactive and carry the fixed geometry below. The heading and the readout are
// display only, and their internal layout is yours." So the readout carries no
// interactive geometry of its own — and, being outside the field's extent, it is
// not the field either, whose press rule would clear the selection.
//
// WHAT A PRESS THERE STILL DOES is set the focus, which `specs/controls.md` routes
// to `field` for "a press anywhere else on the editor screen". The requirement
// here is that nothing else moves.
//
// THE CONFIGURATION. `BARE` opened in the editor, one arm on the field, that arm
// selected, and the tape cursor pointed at column `2` of its row, so all three
// readings carry a value a press could disturb. Four presses, each released before
// the next: the middle of the readout, its included top-left corner
// `(READOUT_X0, HEADING_H)` — which is the corner it shares with the field and the
// heading — its far interior corner `(STAGE_W - 1, TAPE_Y0 - 1)`, and a point
// halfway down its left edge, one unit inside the field's excluded upper bound.
//
// THE VERDICT. After each of the four, `editor.selected` still names the arm,
// `editor.cursor` still points at column `2` of the arm's row, and `editor.drag`
// is still `null`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { HEADING_H, READOUT_X0, STAGE_W, TAPE_Y0 } from "../constants";
import { READOUT_REGION, type StagePoint } from "../field";
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

/** Four points of the readout's half-open extent, its included corner among them. */
const PRESSES: readonly { name: string; at: StagePoint }[] = [
  { name: "the middle of the readout", at: centerOf(READOUT_REGION) },
  {
    name: "its included top-left corner",
    at: { x: READOUT_X0, y: HEADING_H },
  },
  {
    name: "its far interior corner",
    at: { x: STAGE_W - 1, y: TAPE_Y0 - 1 },
  },
  {
    name: "halfway down its left edge",
    at: { x: READOUT_X0, y: (HEADING_H + TAPE_Y0) / 2 },
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the selection, the cursor and the drag standing under every readout press", async () => {
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
    await captureStill(h, "readout");

    const editor = (await h.snapshot()).editor;
    assertEqual(
      editor.selected,
      arm,
      `a press at ${press.name} (${press.at.x}, ${press.at.y}) leaves the arm selected`,
    );
    assertEqual(
      editor.cursor?.part,
      arm,
      "that press leaves the cursor on the arm's row",
    );
    assertEqual(
      editor.cursor?.col,
      CURSOR_COL,
      `that press leaves the cursor at column ${CURSOR_COL}`,
    );
    assertNull(
      editor.drag,
      "that press begins no drag: the readout is display only",
    );

    await releasePointer(h);
  }
});
