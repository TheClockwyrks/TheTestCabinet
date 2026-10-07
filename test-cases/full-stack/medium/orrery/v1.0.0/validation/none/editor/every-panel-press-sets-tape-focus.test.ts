// editor/every-panel-press-sets-tape-focus — a press anywhere in the tape panel
// sets the focus to `tape`, whatever it landed on.
//
// THE RULE. "Every press in the panel sets the focus, as `specs/controls.md`
// states" (`specs/editor.md`, The tape panel), and `specs/controls.md` states what
// it is set to: "A press inside the tape panel's extent, `x >= TRAY_REGION_W`
// (`224`) and `y >= TAPE_Y0` (`560`) as `specs/editor.md` fixes them, sets focus to
// `tape`". The extent is the whole panel, so the rule reaches the presses the
// sentence above it separates by what they do to the cursor: "A press inside a cell
// rectangle ...; a press inside a row's label ...; a press in the panel that lands
// on no row or cell ...". All three are presses in the panel, so all three set the
// focus.
//
// THE CONFIGURATION. `BARE` opened in the editor with two arms and nothing else,
// the cursor cleared, so `firstRow` is `0` and `firstCol` is `0` and the panel's
// rectangles are the unscrolled ones `specs/editor.md` fixes. The three presses are
// made in turn: the middle of the cell at visible row `0`, column `3`; the middle
// of visible row `0`'s label; and the middle of visible row `3`'s cell rectangles,
// which with two arms placed shows no arm at all, so that press lands on no row and
// no cell.
//
// THE FOCUS IS PUT BACK BETWEEN THEM. Before each press the focus is set to `field`
// and read back, so `tape` afterwards is that press's doing rather than a value it
// inherited from the press before. "Focus is `field` on entering the editor", so
// this is the state the rule fires from each time.
//
// THE VERDICT. `editor.focus` reads `tape` after each of the three presses.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { RECORDING_RUN_UP, RECORDING_SETTLE } from "../constants";
import {
  at,
  regionCenter,
  tapeCell,
  tapeLabel,
  type StagePoint,
} from "../field";
import { BARE } from "../fixtures";
import {
  captureReplay,
  createHarness,
  openChallengeDocument,
  placePart,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

/** The two anchors the two arms stand on, six hexes apart and both on the field. */
const FIRST = at(-3, 0);
const SECOND = at(3, 0);

/** A press on a cell: visible row 0, column 3, which the first arm's row holds. */
const ON_A_CELL: StagePoint = regionCenter(tapeCell(0, 3));

/** A press on a label: visible row 0's, which the first arm's row holds. */
const ON_A_LABEL: StagePoint = regionCenter(tapeLabel(0));

/** A press on neither: visible row 3, which with two arms placed shows no arm. */
const ON_NEITHER: StagePoint = regionCenter(tapeCell(3, 3));

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Put the focus on the field, press once in the panel, and answer the focus. */
async function pressFromFieldFocus(where: StagePoint): Promise<string> {
  await h.debug.setFocus("field");
  assertEqual(
    (await h.snapshot()).editor.focus,
    "field",
    "the focus is on the field before the press, so tape focus after it is the press's doing",
  );
  await pressAt(h, where);
  await h.advance(1);
  const focus = (await h.snapshot()).editor.focus;
  await releasePointer(h);
  return focus;
}

it("sets tape focus on a cell press, a label press, and a press on neither", async () => {
  await openChallengeDocument(h, BARE);
  await placePart(h, "arm", FIRST);
  await placePart(h, "arm", SECOND);
  await h.debug.setCursor(null, 0);

  const [onCell, onLabel, onNeither] = await captureReplay(
    h,
    "focus",
    async () => {
      await h.advance(RECORDING_RUN_UP);
      const presses = [
        await pressFromFieldFocus(ON_A_CELL),
        await pressFromFieldFocus(ON_A_LABEL),
        await pressFromFieldFocus(ON_NEITHER),
      ];
      await h.advance(RECORDING_SETTLE);
      return presses;
    },
  );

  assertEqual(
    onCell,
    "tape",
    `a press at (${ON_A_CELL.x}, ${ON_A_CELL.y}), inside a cell rectangle, sets the focus to tape`,
  );
  assertEqual(
    onLabel,
    "tape",
    `a press at (${ON_A_LABEL.x}, ${ON_A_LABEL.y}), inside a row's label, sets the focus to tape`,
  );
  assertEqual(
    onNeither,
    "tape",
    `a press at (${ON_NEITHER.x}, ${ON_NEITHER.y}), on no row and no cell, sets the focus to tape all the same`,
  );
});
