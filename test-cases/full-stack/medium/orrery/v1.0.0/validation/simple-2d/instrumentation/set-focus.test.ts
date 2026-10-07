// instrumentation/set-focus — the operation that routes the shared editing keys.
//
// THE RULE. "`setFocus(where)` | Sets the focus to `"field"` or `"tape"`"
// (`specs/instrumentation.md`, The editor's hands), reported by the snapshot as
// `editor.focus`. What the focus DECIDES is `specs/controls.md`: "`state.editor.focus`
// is `field` or `tape`, and it routes the editing keys... Two focus-routed actions
// share a physical key: `part-grow` and `ins-extend` on `KeyW`, and `part-shrink`
// and `ins-retract` on `KeyS`. Each is registered on its own, and the game reads
// the ones the current focus names."
//
// SO THE CHECK PRESSES ONE PHYSICAL KEY UNDER EACH FOCUS AND READS WHICH ACTION
// THE GAME TOOK. `KeyW` under `field` is `part-grow`, which "Lengthens the
// selected or dragged arm within the bounds `specs/parts.md` fixes"; the same key
// under `tape` is `ins-extend`, which writes `extend` at the cursor
// (`specs/controls.md`, Tape focus). The two consequences are read on two
// different fields of the same part, so neither can be mistaken for the other: the
// length rose and the tape stayed empty, then the tape took `extend` and the
// length stayed where the first press left it.
//
// THE WORLD IS POSED, NOT SEARCHED. A posed challenge, an empty machine, and one
// arm — selected, so the field verb has its target, and with the cursor pointed at
// its cell `0`, so the tape verb has its target. Both hands are posed through the
// surface rather than left to whatever the editor was holding, and no run is
// started: the focus is an editing hand.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { ARM_MIN_LEN } from "../constants";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  partById,
  placePart,
  pressAction,
  type Harness,
} from "../harness";
import { BARE, ORIGIN } from "../fixtures";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("routes KeyW to the arm under field focus and to the tape under tape focus", async () => {
  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();
  const arm = await placePart(h, "arm", ORIGIN, 0);
  await h.debug.setSelected(arm);
  await h.debug.setCursor(arm, 0);

  await h.debug.setFocus("field");
  const onField = await h.snapshot();
  assertEqual(
    onField.editor.focus,
    "field",
    'setFocus("field") sets the focus',
  );

  await pressAction(h, "part-grow");
  const grown = await h.snapshot();
  const lengthened = partById(grown, arm);
  assertNotNull(lengthened, "the arm is still on the machine");
  assertEqual(
    lengthened?.length,
    ARM_MIN_LEN + 1,
    "under field focus KeyW is part-grow, which lengthens the selected arm",
  );
  assertDeepEqual(
    lengthened?.tape,
    [],
    "under field focus KeyW is not ins-extend, so nothing was written to the tape",
  );

  await h.debug.setFocus("tape");
  const onTape = await h.snapshot();
  assertEqual(onTape.editor.focus, "tape", 'setFocus("tape") sets the focus');

  await pressAction(h, "ins-extend");
  await captureStill(h, "focus");

  const written = await h.snapshot();
  const edited = partById(written, arm);
  assertNotNull(edited, "the arm is still on the machine");
  assertDeepEqual(
    edited?.tape,
    ["extend"],
    "under tape focus KeyW is ins-extend, which writes extend at the cursor",
  );
  assertEqual(
    edited?.length,
    ARM_MIN_LEN + 1,
    "under tape focus KeyW is not part-grow, so the arm's length stands where the first press left it",
  );
});
