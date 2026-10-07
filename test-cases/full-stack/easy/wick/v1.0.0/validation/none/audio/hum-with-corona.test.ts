// audio/hum-with-corona — with Corona held on playing the hum loops, and it stops
// on the frame after Corona is removed.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("The loops"): "`hum` is looping on
// every frame exactly when `screen` is `playing` and a held weapon is `halo` or
// `corona` ... and it stops on the frame either stops being true." The cue table
// says the same: "`hum` | `CUES.hum` | Loops while Halo or Corona is held on
// `playing`." specs/evolutions.md ("Corona") repeats it from the weapon's side:
// "Corona keeps the `hum` loop that Halo carried, as `specs/ui.md` states." So
// Corona alone in a slot is one of the two loadouts the loop runs under, and a
// build that hums for Halo but not for its evolved form must grade differently
// from one that hums for neither. specs/instrumentation.md fixes the frame each
// reading is taken on: "Both loops are reconciled from the state on every frame,
// so a state the debug surface posed sounds, one frame later, exactly as the same
// state reached by play."
//
// WHY CORONA IS PLACED RATHER THAN EVOLVED INTO. specs/instrumentation.md's
// `setWeapon(slot, id, level)` takes "weapon `id`, a `WeaponId`" with "`level` ...
// `1` for an evolved one", so Corona is posed directly. Reaching it through a
// chest would put the whole evolution recipe between this point and the loop it
// reads, and that recipe is `evolutions/`'s and `audio/cue-evolve`'s.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing dropped, and no slot held but the Corona this point
// needs — in particular no Halo, so what is read is Corona's own hum rather than
// one Halo could be carrying. `weaponFire` stays off, so the aura pulses nothing
// and no `hit`, `kill`, or Corona heal rides on the frames the loop is read.
//
// THE TOLERANCE. None: a loop is running on a frame or it is not, and each frame
// is exact because the specification names it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { TICK_HZ } from "../constants";
import {
  captureReplay,
  createHarness,
  isLooping,
  weaponSlot,
  type Harness,
} from "../harness";
import { openNight } from "./cues";

/** The slot Corona is posed into: the first, on a loadout `isolate` emptied. */
const CORONA_SLOT = 0;

/** Corona's single level: "an evolved weapon has a single level". */
const CORONA_LEVEL = 1;

/** Frames recorded after each reading, for the replay. Decides nothing. */
const TRAIL_FRAMES = TICK_HZ / 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("hums while Corona is held on playing and stops when it is removed", async () => {
  await openNight(h);

  const corona = await captureReplay(h, "corona", async () => {
    await h.debug.setWeapon(CORONA_SLOT, "corona", CORONA_LEVEL);
    const held = await h.step(1);
    const humming = await isLooping(h, "hum");
    await h.step(TRAIL_FRAMES);

    await h.debug.removeWeapon(CORONA_SLOT);
    const gone = await h.step(1);
    const silent = await isLooping(h, "hum");
    await h.step(TRAIL_FRAMES);

    return { held, humming, gone, silent };
  });

  assertEqual(
    weaponSlot(corona.held, "corona"),
    CORONA_SLOT,
    "the slot Corona was posed into",
  );
  assertEqual(
    corona.humming,
    true,
    "the hum looping on the frame after Corona was held",
  );
  assertLength(
    corona.gone.run.weapons,
    0,
    "the weapons held after Corona was removed",
  );
  assertEqual(
    corona.silent,
    false,
    "the hum looping on the frame after Corona was removed",
  );
});
