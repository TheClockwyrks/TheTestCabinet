// audio/mute-toggles-on-select — the mute action is read on a select screen.
//
// THE RULE. `specs/controls.md` binds it once, globally: "`mute` | `KeyM` |
// Toggles sound, FROM ANY SCREEN", and its table of what each screen reads lists
// it on the select screen's row: "`select` | `up` and `down` move the highlight;
// `confirm` opens the highlighted challenge when the mode's progression allows;
// `back` returns to `title`; `mute`." `specs/ui.md` says what the press does:
// "The game binds the `mute` action to ... the mute bit and toggles it from any
// screen, then mirrors that bit into `state.muted` every frame", and
// `specs/state.md` names the field that mirror lands in: "`muted` — the game's
// readable copy of the engine's mute bit, which every `update` carries into the
// state it returns."
//
// THE WORLD is the campaign's select screen, reached with `setMode` and
// `setScreen("select")` — "Shows the current mode's select screen, `selectIndex`
// at that mode's `last`" (`specs/instrumentation.md`). The bit is read as `false`
// before the press, so what is read after it is the press's own work.
//
// THE VERDICT. `muted` is `true` in the snapshot after the press, and the game is
// still on the select screen with the same row highlighted: `mute` is not one of
// the keys that move the highlight, take a row, or leave.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openSelect,
  openTitle,
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

it("reports muted true after the mute action is pressed on a select screen", async () => {
  await openTitle(h);
  await openSelect(h, "campaign");

  const before = await h.snapshot();
  assertEqual(
    before.screen,
    "select",
    "the world this point reads is a select screen",
  );
  assertEqual(
    before.muted,
    false,
    "sound is on before the press, so what is read after it is the press's own work",
  );
  const row = before.selectIndex;

  const after = await pressAction(h, "mute");

  await captureStill(h, "muted");

  assertEqual(
    after.muted,
    true,
    "the mute action pressed on select reports muted true in the next snapshot",
  );
  assertEqual(
    after.screen,
    "select",
    "and the press left the game where it was: mute neither opens a challenge nor returns to the title",
  );
  assertEqual(after.selectIndex, row, "and did not move the highlight either");
});
