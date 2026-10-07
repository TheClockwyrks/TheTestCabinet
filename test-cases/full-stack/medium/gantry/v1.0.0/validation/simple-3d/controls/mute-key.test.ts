// controls/mute-key — `KeyM` toggles the mute bit, and does it on every screen.
//
// `specs/controls.md` § The actions: the `mute` action is bound to `KeyM` and
// does "toggle sound, on every screen". `specs/ui.md` § Audio states the same:
// "The `mute` action toggles all sound from any screen, and the game stays fully
// playable muted." What the toggle moves is the bit the snapshot reports:
// `specs/state.md` carries "`muted`, the game's readable copy of the runtime's
// mute bit, refreshed on every update."
//
// TWO SCREENS, AND THE BIT BACK WHERE IT STARTED. One press on one screen cannot
// tell a toggle from a switch that only ever mutes, so the action is pressed
// twice: the first press must leave the bit at the opposite of what it held, and
// the second must bring it back. The two presses are made on different screens —
// `title`, which the game opens on, and `run` — because the requirement is that
// the action applies on every screen rather than on the front door alone, and
// `run` is the screen `specs/controls.md` restricts hardest, taking "the camera
// actions, a pointer drag on the camera, `speed`, `mute`, and `back` alone".
//
// Neither press reads the bit's absolute value: `reset` "leaves `muted` as it
// stands rather than turning a player's preference off"
// (`specs/instrumentation.md`), so what a harness starts on is the build's own
// opening preference and the requirement is the flip rather than the value.
//
// A FRAME RUNS AFTER EACH PRESS BEFORE THE BIT IS READ. `muted` is the one field
// the snapshot reports that is not the game's own: it is "the game's readable
// copy of the runtime's mute bit, refreshed on every update"
// (`specs/state.md`), and the specification fixes neither who owns the bit nor
// where in an update the copy is taken. A build that refreshes the copy at the
// top of its update — before the frame's actions are handled — is conformant and
// carries the toggle into the reading a frame later, so the reading is taken
// after a further frame, which is what `specs/instrumentation.md` asks of any
// caller that needs an act consumed: "a caller that needs the game to have
// consumed one runs a frame after it."
//
// The run screen is shown with `setScreen`, which "shows a named screen and sets
// nothing else": what this decides is where the action applies, so it needs the
// screen and nothing a run would bring with it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import { createHarness, type Harness } from "../harness";

/** The `mute` action's binding, as `specs/controls.md` fixes it. */
const MUTE = BINDINGS.mute[0]!;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("flips the mute bit on the title screen and on the run screen", async () => {
  const opening = await h.snapshot();
  assertEqual(opening.screen, "title", "the screen the first press lands on");
  const was = opening.muted;

  await h.press(MUTE);
  await h.advance(1);
  assertEqual(
    (await h.snapshot()).muted,
    !was,
    `muted after ${MUTE} on the title screen, which toggles sound ` +
      "(specs/controls.md)",
  );

  await h.debug.setScreen("run");
  await h.press(MUTE);
  await h.advance(1);
  const after = await h.snapshot();

  await h.advance(1);
  await h.capture("state", "the run screen after the mute action toggled back");

  assertEqual(
    after.muted,
    was,
    `muted after ${MUTE} on the run screen, where the action applies as it ` +
      "does on every screen (specs/ui.md)",
  );
});
