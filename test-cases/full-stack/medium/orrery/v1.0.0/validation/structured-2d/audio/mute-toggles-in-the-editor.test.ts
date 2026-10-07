// audio/mute-toggles-in-the-editor — the mute action is read in the editor while
// editing.
//
// THE RULE. `specs/controls.md` binds it once, globally: "`mute` | `KeyM` |
// Toggles sound, FROM ANY SCREEN", and its table of what each screen reads ends
// the editor's editing row with it: "`editor`, while editing | The pointer; the
// field-focus actions under `field` focus; the tape-focus actions and `up`,
// `down`, `left`, and `right` under `tape` focus; `undo`; `redo`; `play`; `step`;
// `back`; `mute`." `specs/ui.md` says what the press does: "The game binds the
// `mute` action to ... the mute bit and toggles it from any screen, then mirrors
// that bit into `state.muted` every frame", and `specs/state.md` names the field
// that mirror lands in: "`muted` — the game's readable copy of the engine's mute
// bit, which every `update` carries into the state it returns."
//
// THE WORLD is the editor over a posed challenge with one arm placed and selected
// under field focus, and no run live — which is "while editing". The focus is set
// deliberately: `KeyM` is bound to `mute` alone in the whole binding table, under
// either focus, so a build that routed the key by focus has both routes covered
// by the one press.
//
// THE VERDICT. `muted` is `true` in the snapshot after the press, the game is
// still in the editor, and the machine, the selection and the histories are
// exactly as they were: `mute` is a global toggle rather than an edit.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  openTitle,
  placePart,
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

it("reports muted true after the mute action is pressed while editing", async () => {
  await openTitle(h);

  await openChallengeDocument(h, BARE);
  const arm = await placePart(h, "arm", ORIGIN, 0);
  await h.debug.setSelected(arm);
  await h.debug.setFocus("field");
  await h.advance(1);

  const before = await h.snapshot();
  assertEqual(
    before.screen,
    "editor",
    "the world this point reads is the editor screen",
  );
  assertNull(before.sim, "while editing, with no run live");
  assertEqual(
    before.muted,
    false,
    "sound is on before the press, so what is read after it is the press's own work",
  );
  const undoDepth = before.editor.undoDepth;

  const after = await pressAction(h, "mute");

  await captureStill(h, "muted");

  assertEqual(
    after.muted,
    true,
    "the mute action pressed on the editor screen while editing reports muted true in the next snapshot",
  );
  assertEqual(
    after.screen,
    "editor",
    "and the press left the game in the editor",
  );
  assertEqual(
    after.editor.parts.length,
    1,
    "with the machine as it stood: mute is not an edit",
  );
  assertEqual(after.editor.selected, arm, "and the selection as it stood");
  assertEqual(
    after.editor.undoDepth,
    undoDepth,
    "and nothing pushed onto the undo history",
  );
});
