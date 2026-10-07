// instrumentation/reset-leaves-muted — the one field reset does not touch.
//
// THE RULE. `reset` "Restores every declared field of the game's state to its
// title-screen value", and then, immediately beneath it: "`muted` is untouched; the
// runtime owns muting" (`specs/instrumentation.md`, Session). The snapshot carries
// it as a mirror rather than as a value of the game's own: "`muted` mirrors the
// runtime's mute bit" (Snapshot shape), which `specs/ui.md` fixes the other end of —
// "Muting and the first-interaction unlock belong to the runtime. The game binds the
// `mute` action to the runtime's mute bit and toggles it from any screen, then
// mirrors that bit into `state.muted` every frame."
//
// SO THE BIT IS MOVED THE PLAYER'S WAY. The surface carries no operation for muting
// at all, and none for the registered actions either, so the toggle below is a real
// press of the key `specs/controls.md` binds `mute` to — which is the only way this
// point can be posed, and the right one: the requirement is precisely that the
// runtime's bit outlives a reset of the game's state.
//
// BOTH DIRECTIONS, BECAUSE "UNTOUCHED" IS NOT "OFF". A build that cleared the bit on
// every reset passes a check that only ever resets while unmuted, and a build that
// set it would pass a check that only ever resets while muted. So the reading is
// taken across a reset with the bit ON, and again across a reset with it back OFF.

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

/** The mute bit as the snapshot mirrors it, after a frame has carried it across. */
async function mirrored(): Promise<boolean> {
  await h.advance(1);
  return (await h.snapshot()).muted;
}

it("reports the same mute bit across a reset, whichever way it stood", async () => {
  await openTitle(h);
  const opened = await mirrored();

  // Muted, then reset.
  await pressAction(h, "mute");
  const muted = await mirrored();
  assertEqual(
    muted,
    !opened,
    "the mute action toggles the runtime's bit, and the game mirrors it",
  );

  await h.debug.reset();
  assertEqual(
    (await h.snapshot()).muted,
    muted,
    "reset leaves muted untouched: the runtime owns muting",
  );
  assertEqual(
    await mirrored(),
    muted,
    "and the frames after the reset go on mirroring the same bit",
  );
  await captureStill(h, "muted");

  // And back the other way, across another reset.
  await pressAction(h, "mute");
  const unmuted = await mirrored();
  assertEqual(unmuted, opened, "the action toggles it back");

  await h.debug.reset();
  assertEqual(
    (await h.snapshot()).muted,
    unmuted,
    "and reset leaves it untouched that way round too",
  );
  assertEqual(
    await mirrored(),
    unmuted,
    "however the bit stood when the reset happened",
  );
});
