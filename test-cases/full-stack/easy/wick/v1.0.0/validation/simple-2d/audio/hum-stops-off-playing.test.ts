// Wick — audio/hum-stops-off-playing: with Halo held and `hum` looping,
// opening the level-up overlay and pausing each leave `hum` not looping on the
// next frame.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/ui.md (The loops): "`hum` is looping on every frame exactly when
//     `screen` is `playing` and a held weapon is `halo` or `corona` ... and it
//     stops on the frame either stops being true", and "Both loops are
//     reconciled from the state on every frame".
//   - specs/ui.md (Audio): "`hum` | Loops while Halo or Corona is held on
//     `playing`", which `music` does not do: the two overlays and the pause
//     keep `music` and drop `hum`.
//   - specs/progression.md: "A `playing` tick that ends with `pendingLevelUps`
//     above `0` ... opens the overlay: `screen` becomes `levelup`".
//   - specs/instrumentation.md (`setScreen`): the `paused` row, "Exactly as
//     `pause` does"; a pose "sounds nothing".
//
// WHAT IS READ. `looping("hum")` one frame after the level-up overlay opened,
// which is `false`, and, on a second night, one frame after the pause, which is
// `false` too. Each is preceded by the reading the requirement names, "with
// Halo held and `hum` looping", so each `false` is a stop and not a loop that
// never ran.
//
// WHY THE TWO NIGHTS ARE POSED AS THEY ARE. Both are isolated nights with
// nothing on the field and every driver switch off, holding Halo alone, and one
// tick first so the loop is running. Halo is never removed, so the only term of
// the loop's condition that changes is the screen, which is what this point is
// about. The overlay is opened from a queued level-up rather than from a gem,
// so no collection or kill lands beside the reading.
//
// TOLERANCE. None. Every reading is a boolean.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  holdWeapon,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("stops the hum on the frame after the overlay opens and after the pause", async () => {
  isolate(h);
  holdWeapon(h, "halo", 1);
  await h.tick(1);
  assertEqual(h.looping("hum"), true, "hum looping with Halo held on playing");

  const overlay = await captureReplay(h, "stopped", async () => {
    await openLevelUp(h, 1);
    return h.tick(1);
  });

  assertEqual(overlay.screen, "levelup", "the screen the overlay opened on");
  assertEqual(
    h.looping("hum"),
    false,
    "hum looping on the frame after the overlay opened",
  );

  isolate(h);
  holdWeapon(h, "halo", 1);
  await h.tick(1);
  assertEqual(h.looping("hum"), true, "hum looping before the pause");

  h.debug.setScreen("paused");
  const paused = await h.tick(1);

  assertEqual(paused.screen, "paused", "the screen the pause entered");
  assertEqual(
    h.looping("hum"),
    false,
    "hum looping on the frame after the pause",
  );
});
