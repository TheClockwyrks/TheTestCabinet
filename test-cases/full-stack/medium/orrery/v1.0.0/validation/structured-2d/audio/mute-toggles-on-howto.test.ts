// audio/mute-toggles-on-howto — the mute action is read on the how-to screen.
//
// THE RULE. `specs/controls.md` binds it once, globally: "`mute` | `KeyM` |
// Toggles sound, FROM ANY SCREEN", and its table of what each screen reads lists
// it on the how-to's row: "`howto` | `left` and `right` turn the page; `confirm`
// and `back` return to `title`; `mute`." `specs/ui.md` says the same from the
// other side — "`mute` is read on every screen" — and says what the press does:
// "The game binds the `mute` action to ... the mute bit and toggles it from any
// screen, then mirrors that bit into `state.muted` every frame".
// `specs/state.md` names the field that mirror lands in: "`muted` — the game's
// readable copy of the engine's mute bit, which every `update` carries into the
// state it returns."
//
// THE WORLD is the how-to at its first page, reached with `setScreen("howto")`,
// which "Shows the how-to, `howtoPage` at `0`" and enters the screen "exactly as
// the real transition into it enters it" (`specs/instrumentation.md`). The bit is
// read as `false` before the press, so what is read after it is the press's own
// work.
//
// THE VERDICT. `muted` is `true` in the snapshot after the press, and the game is
// still on the how-to at the page it was on: `mute` is not one of the two keys
// that turn the pages, and not one of the two that leave.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openHowto,
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

it("reports muted true after the mute action is pressed on the how-to", async () => {
  await openTitle(h);
  await openHowto(h);

  const before = await h.snapshot();
  assertEqual(
    before.screen,
    "howto",
    "the world this point reads is the how-to screen",
  );
  assertEqual(
    before.muted,
    false,
    "sound is on before the press, so what is read after it is the press's own work",
  );
  const page = before.howtoPage;

  const after = await pressAction(h, "mute");

  await captureStill(h, "muted");

  assertEqual(
    after.muted,
    true,
    "the mute action pressed on howto reports muted true in the next snapshot",
  );
  assertEqual(
    after.screen,
    "howto",
    "and the press left the game where it was: mute is not one of the keys that leave the how-to",
  );
  assertEqual(after.howtoPage, page, "and did not turn the page either");
});
