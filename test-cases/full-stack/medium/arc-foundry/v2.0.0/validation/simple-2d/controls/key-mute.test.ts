// controls/key-mute — `KeyM` toggles audio mute, from any screen.
//
// THE REQUIREMENT. `specs/controls.md` binds `mute` to `KeyM`: "Toggles audio
// mute." `specs/ui.md` puts the mute bit itself in the engine and requires the
// game to bind the action to it and toggle it "from any screen", and
// `specs/instrumentation.md` reports it as `muted`, mirroring the bit the runtime
// holds and refreshed on every update, and lists it as one of the two fields
// `reset` deliberately leaves alone because it is a player preference rather than
// run state.
//
// HOW IT IS DECIDED. The key is pressed on the title screen, where a run has not
// even begun, and read; pressed again and read again, so both directions of the
// toggle are decided. The whole thing is then repeated mid-wave on `playing`,
// which is the "from any screen" half: a build that reads the key only while a
// run is up passes the second half and fails the first.
//
// The bit each half starts from is READ rather than assumed, because `reset` does
// not touch it and the first half may therefore leave it either way round.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  keyFor,
  openYard,
  pressAction,
  releaseUnit,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** Press the mute key and hand back the bit the game reports after it. */
async function toggle(harness: Harness): Promise<boolean> {
  await pressAction(harness, "mute");
  return harness.snapshot().muted;
}

it("toggles the mute bit on the title and again mid-wave", async () => {
  // The title: a fresh engine opens unmuted, and `reset` leaves the bit alone.
  h.debug.reset();
  const opened = h.snapshot();
  assertEqual(
    opened.screen,
    "title",
    "the screen a reset returns to (specs/ui.md)",
  );

  const before = opened.muted;
  assertEqual(
    await toggle(h),
    !before,
    `pressing ${keyFor("mute")} on the title to toggle the mute bit ` +
      "(specs/ui.md)",
  );
  captureStill(h, "mute");
  assertEqual(
    await toggle(h),
    before,
    `pressing ${keyFor("mute")} again on the title to toggle it back ` +
      "(specs/controls.md)",
  );

  // And mid-wave, which is the other end of "from any screen".
  openYard(h, { wave: 4 });
  releaseUnit(h, "mote", { frozen: true });

  const playing = h.snapshot();
  assertEqual(
    playing.screen,
    "playing",
    "the screen a wave runs on (specs/ui.md)",
  );

  const midwave = playing.muted;
  assertEqual(
    await toggle(h),
    !midwave,
    `pressing ${keyFor("mute")} mid-wave to toggle the mute bit ` +
      "(specs/ui.md)",
  );
  assertEqual(
    await toggle(h),
    midwave,
    `pressing ${keyFor("mute")} again mid-wave to toggle it back ` +
      "(specs/controls.md)",
  );
});
