// audio/hum-stops-off-playing — with Halo held and hum looping, opening the
// level-up overlay and pausing each leave hum not looping on the next frame.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("The loops"): "`hum` is looping on
// every frame exactly when `screen` is `playing` and a held weapon is `halo` or
// `corona` ... and it stops on the frame either stops being true." The loadout is
// unchanged on both legs below, so what stops the loop each time is the screen
// leaving `playing` — which is the one thing this point decides, on the two
// screens the review item names. `music` runs on through both (specs/ui.md loops
// it on `levelup` and `paused`), so the two loops are asked for different things
// by the same frame, and the hum's is what is read.
// specs/instrumentation.md fixes the frame each reading is taken on: "Both loops
// are reconciled from the state on every frame, so a state the debug surface
// posed sounds, one frame later, exactly as the same state reached by play."
//
// WHY EACH LEG POSES ITS OWN NIGHT. The two are the same requirement on two
// screens, so neither leg is allowed to depend on the other's way back: the
// overlay leg would have to be closed through an acceptance, which is
// `audio/cue-choose`'s and `progression/`'s, and a build with a broken
// acceptance would fail this point for something it does not decide. So the
// second leg opens a fresh isolated night of its own.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night on each leg: every driver
// switch off, nothing alive, nothing dropped, and no slot held but the Halo this
// point needs, so nothing on any frame can end the run or move the screen except
// the one transition being read. `weaponFire` stays off, so the aura pulses
// nothing and no other cue rides on the frames the loop is read. The overlay is
// opened the way specs/progression.md states — one queued level-up and the tick
// that ends with it — and the pause is posed through the surface, whose
// `setScreen("paused")` from `playing` is "Exactly as `pause` does"
// (specs/instrumentation.md), so the pause control's own correctness is
// `controls/`'s rather than this point's.
//
// THE HUM IS ESTABLISHED ON EACH LEG FIRST, so each reading is of a loop that
// stopped rather than of one that never started.
//
// THE TOLERANCE. None: a loop is running on a frame or it is not, and each frame
// is exact because the specification names it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TICK_HZ } from "../constants";
import {
  captureReplay,
  createHarness,
  holdWeapon,
  isLooping,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";
import { openNight, SETTLE_FRAMES } from "./cues";

/** One level-up queued, enough to open one overlay. */
const QUEUED = 1;

/** Frames recorded after each reading, for the replay. Decides nothing. */
const TRAIL_FRAMES = TICK_HZ / 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("stops the hum when the screen leaves playing for the overlay or the pause", async () => {
  await openNight(h);
  await holdWeapon(h, "halo");
  await h.step(1);
  assertEqual(
    await isLooping(h, "hum"),
    true,
    "the hum looping on playing with Halo held, before the overlay",
  );

  const off = await captureReplay(h, "stopped", async () => {
    const overlay = await openLevelUp(h, QUEUED);
    await h.step(1);
    const onOverlay = await isLooping(h, "hum");
    await h.step(TRAIL_FRAMES);

    await isolate(h);
    await h.step(SETTLE_FRAMES);
    await holdWeapon(h, "halo");
    await h.step(1);
    const beforePause = await isLooping(h, "hum");

    await h.debug.setScreen("paused");
    const paused = await h.step(1);
    const onPause = await isLooping(h, "hum");
    await h.step(TRAIL_FRAMES);

    return { overlay, onOverlay, beforePause, paused, onPause };
  });

  assertEqual(
    off.overlay.screen,
    "levelup",
    "the screen the queued level-up opened",
  );
  assertEqual(
    off.onOverlay,
    false,
    "the hum looping on the frame after the overlay opened",
  );

  assertEqual(
    off.beforePause,
    true,
    "the hum looping on playing with Halo held, before the pause",
  );
  assertEqual(off.paused.screen, "paused", "the screen the pause posed");
  assertEqual(
    off.onPause,
    false,
    "the hum looping on the frame after the pause",
  );
});
