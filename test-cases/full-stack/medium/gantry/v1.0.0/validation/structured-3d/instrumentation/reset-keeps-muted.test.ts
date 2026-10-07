// instrumentation/reset-keeps-muted — a reset leaves the mute bit as it stands.
//
// `specs/instrumentation.md` § The run and the screens names the one exception to
// everything else a reset restores: "The one field left alone is `muted`, the
// game's readable copy of a mute bit it does not own (`specs/state.md`), which
// `reset` leaves as it stands rather than turning a player's preference off."
//
// THE PREFERENCE IS SET THE WAY A PLAYER SETS IT, through the action bound to it:
// `specs/controls.md` binds `mute` to `KeyM` and gives it as "toggle sound, on
// every screen", and `specs/ui.md` says "The `mute` action toggles all sound from
// any screen". Nothing on the debug surface poses `muted` — it is the runtime's
// bit and the game only mirrors it (`specs/state.md`: "refreshed on every
// update") — so the key press is the only way to stand the scenario up, and a
// frame is run after it so the mirror has been refreshed.
//
// The check reads the field back before resetting, so a `true` afterwards is a
// preference the reset kept rather than one that was never on. The title screen
// is where the harness's opening reset leaves the game and one of the screens the
// action works from, so nothing is opened or built on the way.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import { createHarness, type Harness } from "../harness";

/** The key `specs/controls.md` binds the `mute` action to. */
const MUTE_KEY = "KeyM";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the mute bit as it stands", async () => {
  await h.press(MUTE_KEY);
  await h.advance(1);
  assertTrue(
    (await h.snapshot()).muted,
    `the mute the ${MUTE_KEY} press turned on, before the reset ` +
      "(specs/controls.md)",
  );

  await h.debug.reset();
  const muted = (await h.snapshot()).muted;
  await h.advance(1);
  await h.capture("muted", "The mute bit a reset leaves standing");

  assertTrue(
    muted,
    "muted after a reset: the one field a reset leaves alone " +
      "(specs/instrumentation.md)",
  );
});
