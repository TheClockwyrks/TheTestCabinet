// audio/mute-toggles-on-title — the mute action is read on the title screen.
//
// THE RULE. `specs/controls.md` binds it once, globally: "`mute` | `KeyM` |
// Toggles sound, FROM ANY SCREEN", and its table of what each screen reads lists
// it on every row, the title's included: "`title` | `up` and `down` move the
// highlight; `confirm` takes it; `mute`." `specs/ui.md` says what the press does:
// "The game binds the `mute` action to ... the mute bit and toggles it from any
// screen, then mirrors that bit into `state.muted` every frame", and
// `specs/state.md` names the field that mirror lands in: "`muted` — the game's
// readable copy of the engine's mute bit, which every `update` carries into the
// state it returns."
//
// SO THE PRESS IS THE PLAYER'S, AND THE READING IS THE NEXT FRAME'S. The surface
// carries no operation for a registered action, so `mute` is pressed on the real
// keyboard through the key `specs/controls.md` binds it to, and the snapshot read
// is the one after the frame that delivered the press — which is where a bit
// "mirrored into the state every update" appears.
//
// THE WORLD is the title screen a fresh game stands on, with nothing placed and
// no run live, and the bit read as `false` before the press so what is read after
// it is the press's own work.
//
// THE VERDICT. `muted` is `true` in the snapshot after the press, and the game is
// still on the title screen: `mute` is a global toggle rather than a menu key.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
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

it("reports muted true after the mute action is pressed on the title", async () => {
  await openTitle(h);

  const before = await h.snapshot();
  assertEqual(
    before.screen,
    "title",
    "the world this point reads is the title screen",
  );
  assertEqual(
    before.muted,
    false,
    "sound is on before the press, so what is read after it is the press's own work",
  );

  const after = await pressAction(h, "mute");

  await captureStill(h, "muted");

  assertEqual(
    after.muted,
    true,
    "the mute action pressed on title reports muted true in the next snapshot",
  );
  assertEqual(
    after.screen,
    "title",
    "and the press left the game where it was: mute toggles sound rather than taking a menu item",
  );
});
