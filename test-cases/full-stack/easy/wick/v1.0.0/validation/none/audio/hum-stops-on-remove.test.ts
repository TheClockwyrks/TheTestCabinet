// audio/hum-stops-on-remove — with Halo held and hum looping, removing Halo
// leaves hum not looping on the next frame.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("The loops"): "`hum` is looping on
// every frame exactly when `screen` is `playing` and a held weapon is `halo` or
// `corona` ... and it stops on the frame either stops being true." Removing Halo
// makes the loadout condition false with the screen unchanged, so the loop stops.
// specs/instrumentation.md fixes the frame the reading is taken on: "Both loops
// are reconciled from the state on every frame, so a state the debug surface
// posed sounds, one frame later, exactly as the same state reached by play."
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing dropped, and no slot held but the Halo this point needs,
// so nothing on any frame can move the screen, end the run, or put another
// humming weapon in a slot. `removeWeapon(slot)` is the atomic pose for it, and
// specs/instrumentation.md keeps it to the loadout: "Removes the weapon in
// `slot`, a held slot. Its aura or lantern set is removed on the next `playing`
// tick under the placement rule." `weaponFire` stays off, so the aura pulses
// nothing and no other cue rides on the frames the loop is read.
//
// THE HUM IS ESTABLISHED FIRST, so the reading after the removal is of a loop
// that stopped rather than of one that never started. That it starts on
// acquisition is `audio/hum-starts-on-acquire`'s point; here it is a
// precondition.
//
// THE TOLERANCE. None: a loop is running on the frame or it is not, and the frame
// is exact because the specification names it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { TICK_HZ } from "../constants";
import {
  captureReplay,
  createHarness,
  holdWeapon,
  isLooping,
  type Harness,
} from "../harness";
import { openNight } from "./cues";

/** Frames recorded after the reading, for the replay. Decides nothing. */
const TRAIL_FRAMES = TICK_HZ / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stops the hum on the frame after Halo leaves the loadout", async () => {
  await openNight(h);
  const slot = await holdWeapon(h, "halo");
  await h.step(1);
  assertEqual(
    await isLooping(h, "hum"),
    true,
    "the hum looping on playing with Halo held, before the removal",
  );

  const removed = await captureReplay(h, "stopped", async () => {
    await h.debug.removeWeapon(slot);
    const after = await h.step(1);
    const humming = await isLooping(h, "hum");
    await h.step(TRAIL_FRAMES);
    return { after, humming };
  });

  assertLength(
    removed.after.run.weapons,
    0,
    "the weapons held after Halo was removed",
  );
  assertEqual(
    removed.humming,
    false,
    "the hum looping on the frame after Halo was removed",
  );
});
