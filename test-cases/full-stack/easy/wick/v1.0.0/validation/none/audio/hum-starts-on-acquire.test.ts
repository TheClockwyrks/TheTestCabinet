// audio/hum-starts-on-acquire — hum is looping on the frame after Halo enters a
// weapon slot on playing, and is not looping before.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("The loops"): "`hum` is looping on
// every frame exactly when `screen` is `playing` and a held weapon is `halo` or
// `corona`. It starts on the frame that first makes both true, whether Halo was
// just acquired or play just resumed from an overlay or a pause". The cue table
// says the same in one line: "`hum` | `CUES.hum` | Loops while Halo or Corona is
// held on `playing`." specs/instrumentation.md fixes the frame the reading is
// taken on: "Both loops are reconciled from the state on every frame, so a state
// the debug surface posed sounds, one frame later, exactly as the same state
// reached by play." So the loop is read on the frame after the slot is filled.
//
// BOTH DIRECTIONS ARE ONE REQUIREMENT HERE, and the review item states both: the
// silence before is what makes the loop after a reading rather than an accident
// of a build that hums under everything.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing dropped, and no slot held, so the game stands on
// `playing` with the second of the two conditions false and nothing on any frame
// can move the screen or end the run. Halo then enters the first free slot
// through `setWeapon`, which specs/instrumentation.md keeps to the state alone:
// "Nothing else changes: the aura of Halo or Corona ... appear[s] on the next
// `playing` tick under the placement rule." `weaponFire` stays off, so the aura
// pulses nothing and no `hit` or `kill` can ride on the frame the loop is read.
//
// WHAT IS READ, AND WHY IT IS THE FAIR READING. specs/ui.md: "A looping cue
// sounds through a single source set to loop, from the frame that starts it until
// the frame that stops it", so the injected probe holds a source from its
// `start()` until it is stopped, disconnected, ended, or paused, and this reads
// whether a source of `hum` is among them. Nothing about waveform, gain, or level
// is assumed.
//
// THE TOLERANCE. None: a loop is running on the frame or it is not, and both
// frames are exact because the specification names them.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TICK_HZ } from "../constants";
import {
  captureReplay,
  createHarness,
  holdWeapon,
  isLooping,
  weaponSlot,
  type Harness,
} from "../harness";
import { openNight } from "./cues";

/** Frames recorded after the reading, for the replay. Decides nothing. */
const TRAIL_FRAMES = TICK_HZ / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("starts the hum on the frame after Halo enters a slot on playing", async () => {
  const opened = await openNight(h);
  assertEqual(
    opened.screen,
    "playing",
    "the screen the isolated night stands on",
  );

  const acquired = await captureReplay(h, "started", async () => {
    const before = await isLooping(h, "hum");
    await holdWeapon(h, "halo");
    const after = await h.step(1);
    const humming = await isLooping(h, "hum");
    await h.step(TRAIL_FRAMES);
    return { before, after, humming };
  });

  assertEqual(
    acquired.before,
    false,
    "the hum looping on playing with no weapon held",
  );
  assertEqual(
    weaponSlot(acquired.after, "halo"),
    0,
    "the slot Halo entered on the free loadout",
  );
  assertEqual(
    acquired.humming,
    true,
    "the hum looping on the frame after Halo was acquired",
  );
});
