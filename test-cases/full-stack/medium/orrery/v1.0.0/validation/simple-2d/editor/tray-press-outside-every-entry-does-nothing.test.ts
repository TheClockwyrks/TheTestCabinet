// editor/tray-press-outside-every-entry-does-nothing — a tray press that lands on
// no entry begins no drag and disturbs nothing.
//
// THE RULE. "A press in the tray outside every entry does nothing beyond setting
// the focus" (`specs/editor.md`, The tray). Which points are outside every entry
// follows from the entry rectangle the same section fixes — "Entry `k`, counted
// from `0`, occupies the rectangle from `(TRAY_X0, TRAY_Y0 + k * TRAY_SLOT_H)` to
// `(TRAY_X0 + TRAY_W, TRAY_Y0 + (k + 1) * TRAY_SLOT_H)`, with `TRAY_X0` `8`,
// `TRAY_Y0` `56`, `TRAY_SLOT_H` `30`, and `TRAY_W` `208`" — read with the layout
// rule that "every rectangle this file fixes, includes its lower bound and
// excludes its upper". The tray's own extent is wider and taller than its entries:
// "`x` `0` to `TRAY_REGION_W` (`224`), `y` `HEADING_H` (`48`) to `STAGE_H` (`720`)".
//
// AND WHAT THE FOCUS DOES is stated by `specs/controls.md`: "a press anywhere else
// on the editor screen sets it to `field`". The focus is therefore read as well as
// the three hands — it is the "beyond" the rule allows, and reading it is what
// says the press was delivered at all rather than lost.
//
// THE CONFIGURATION. `BARE` opened in the editor — a tray of three entries, `arm`,
// one rise and one set — with one arm on the field, that arm selected, and the
// cursor on column `2` of its row. Four presses, each released before the next and
// each read against that same standing state, and the focus put back to `tape`
// before each so the change is the press's: to the left of the entries at
// `TRAY_X0 - 1`; on the entries' excluded right edge at `TRAY_X0 + TRAY_W`; above
// the first entry, between `HEADING_H` and `TRAY_Y0`; and below the last entry,
// on the row where a fourth entry would have begun.
//
// THE VERDICT. After each press `editor.drag` is `null`, `editor.selected` still
// names the arm, `editor.cursor` still points at column `2` of its row — and
// `editor.focus` is `field`, so the press did reach the editor.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { HEADING_H, TRAY_SLOT_H, TRAY_W, TRAY_X0, TRAY_Y0 } from "../constants";
import { type StagePoint } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import { derivedTray } from "../formats";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  placePart,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

/** The column of the tape cursor this check parks and then reads back. */
const CURSOR_COL = 2;

/** The row a fourth entry of `BARE`'s three-entry tray would have begun on. */
const PAST_LAST = TRAY_Y0 + derivedTray(BARE).length * TRAY_SLOT_H;

/** Four points inside the tray's extent and outside every entry rectangle. */
const PRESSES: readonly { name: string; at: StagePoint }[] = [
  {
    name: "left of the entries",
    at: { x: TRAY_X0 - 1, y: TRAY_Y0 + TRAY_SLOT_H / 2 },
  },
  {
    name: "on the entries' excluded right edge",
    at: { x: TRAY_X0 + TRAY_W, y: TRAY_Y0 + TRAY_SLOT_H / 2 },
  },
  {
    name: "above the first entry",
    at: { x: TRAY_X0 + TRAY_W / 2, y: (HEADING_H + TRAY_Y0) / 2 },
  },
  {
    name: "below the last entry",
    at: { x: TRAY_X0 + TRAY_W / 2, y: PAST_LAST + TRAY_SLOT_H / 2 },
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("begins nothing and moves nothing when the press lands on no entry", async () => {
  await openChallengeDocument(h, BARE);
  const arm = await placePart(h, "arm", ORIGIN);
  await h.debug.setSelected(arm);
  await h.debug.setCursor(arm, CURSOR_COL);

  for (const press of PRESSES) {
    await h.debug.setFocus("tape");
    assertEqual(
      (await h.snapshot()).editor.focus,
      "tape",
      "the focus is on the tape before the press, so field focus after it is the press's doing",
    );

    await pressAt(h, press.at);
    await h.advance(1);
    await captureStill(h, "gutter");

    const editor = (await h.snapshot()).editor;
    assertNull(
      editor.drag,
      `a press ${press.name} (${press.at.x}, ${press.at.y}) lands on no entry, so it begins no drag`,
    );
    assertEqual(
      editor.selected,
      arm,
      "that press leaves the arm selected: it does nothing beyond setting the focus",
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
    assertEqual(
      editor.focus,
      "field",
      "that press did reach the editor: a press outside the tape panel sets the focus to field",
    );

    await releasePointer(h);
  }
});
