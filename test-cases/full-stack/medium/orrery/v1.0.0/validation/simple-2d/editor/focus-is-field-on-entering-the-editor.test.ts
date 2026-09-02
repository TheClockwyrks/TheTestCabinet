// editor/focus-is-field-on-entering-the-editor — a challenge opens with the focus
// on the field, whatever it was when the editor was last left.
//
// THE RULE. "Focus is `field` on entering the editor" (`specs/controls.md`,
// Focus). What entering the editor is is fixed by `specs/editor.md`: "Opening a
// challenge from a select screen shows this editor with that challenge's tray",
// and "`back` while editing returns to that select screen". The focus is not
// among the things a later visit restores: "leaving by any route keeps the
// machine, and every later visit in the session restores it exactly, tapes
// included" names the machine and its tapes, and nothing else.
//
// A BUILD THAT NEVER ENTERED MUST NOT PASS. `field` is also the focus's RESTING
// value — "`editor`... `focus` `"field"`... when nothing is open"
// (`specs/instrumentation.md`) — so the check reads the screen and the open
// challenge beside the focus: the verdict is about an editor that is actually
// open.
//
// THE SCENARIO IS DRIVEN THE PLAYER'S WAY. The challenge is opened from the
// campaign's select screen with `confirm`, which "accepts the highlighted item"
// (`specs/controls.md`) — row `0`, which is open however little progress there is.
// The focus is then posed to `tape` through the surface and read back, so the
// editor is genuinely LEFT with the focus on the panel; `back` returns to the
// select screen, and `confirm` opens the same challenge again.
//
// THE VERDICT. On the second entry the screen is `editor`, a challenge is open,
// and `editor.focus` reads `field`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import {
  captureStill,
  createHarness,
  openSelect,
  pressAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the editor on field focus after it was left on tape focus", async () => {
  await h.debug.reset();
  await openSelect(h, "campaign");
  await h.debug.setSelectIndex(0);

  const first = await pressAction(h, "confirm");
  assertEqual(
    first.screen,
    "editor",
    "confirm on the select screen's first row opens that challenge in the editor",
  );

  await h.debug.setFocus("tape");
  const posed = await h.snapshot();
  assertEqual(
    posed.editor.focus,
    "tape",
    "the editor is left with the focus on the tape panel, which is what the entry has to overrule",
  );

  const left = await pressAction(h, "back");
  assertEqual(
    left.screen,
    "select",
    "back while editing returns to that select screen",
  );

  await pressAction(h, "confirm");
  await captureStill(h, "fresh");

  const entered = await h.snapshot();
  assertEqual(
    entered.screen,
    "editor",
    "the challenge is open in the editor again",
  );
  assertNotNull(
    entered.challenge,
    "and the editor is showing a challenge rather than resting",
  );
  assertEqual(
    entered.editor.focus,
    "field",
    "the focus is field on entering the editor, whatever it was when the editor was last left",
  );
});
