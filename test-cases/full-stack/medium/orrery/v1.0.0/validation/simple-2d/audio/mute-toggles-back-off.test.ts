// audio/mute-toggles-back-off — pressing mute again turns sound back on.
//
// THE RULE. The action is a TOGGLE, not a switch that only closes:
// "`mute` | `KeyM` | TOGGLES sound, from any screen" (`specs/controls.md`), and
// `specs/ui.md` says the same of the bit behind it — "The game binds the `mute`
// action to ... the mute bit and TOGGLES IT from any screen, then mirrors that bit
// into `state.muted` every frame". `specs/state.md` names the field the mirror
// lands in: "`muted` — the game's readable copy of the engine's mute bit, which
// every `update` carries into the state it returns." A toggle read once tells you
// nothing about the way back, which is what this point is: from `true` to
// `false`.
//
// THE WORLD is the title screen, so the two presses are read on the plainest
// screen the game has, with nothing placed and no run live. The FIRST press is
// this check's posing step — the point that decides what it does is
// `mute-toggles-on-title` — and the second press is the verdict.
//
// THE VERDICT. After the mute action has set `muted` `true`, pressing it again
// reports `muted` `false` in the next snapshot, and the game is still on the
// title screen.

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

it("reports muted false after a second press of the mute action", async () => {
  await openTitle(h);

  assertEqual(
    (await h.snapshot()).muted,
    false,
    "sound is on to begin with, so the first press is what sets the bit this point clears",
  );

  const muted = await pressAction(h, "mute");
  assertEqual(
    muted.muted,
    true,
    "the first press set muted true, which is the world this point reads",
  );

  const unmuted = await pressAction(h, "mute");

  await captureStill(h, "unmuted");

  assertEqual(
    unmuted.muted,
    false,
    "pressing the mute action again reports muted false in the next snapshot",
  );
  assertEqual(
    unmuted.screen,
    "title",
    "and the press left the game where it was: mute toggles sound rather than taking a menu item",
  );
});
