// Wick — clock/levelup-ticks-nothing: the levelup overlay ticks nothing.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/overview.md` ("Units, ticks, the world, and the camera"): "Only
//     the `playing` screen ticks; the level-up and chest overlays and every
//     other screen tick nothing".
//   - `specs/progression.md` ("The level-up overlay"): "the simulation does
//     not tick while it is open, so the world behind it is frozen exactly as
//     that tick left it." And of the chest overlay: "The simulation does not
//     tick while the overlay is open".
//   - `specs/ui.md` (the screen table): "`levelup`, `chest`, `paused` |
//     Nothing. The world beneath holds exactly the tick it was at."
//
// THE DRIVE. Twice, from an isolated run, the live world of `live-world.ts`
// is posed with every switch on: a moth chasing, a bolt flying, a puddle and
// the bolt with `ttl` counting, a contact cooldown, Ember's cooldown, and the
// director's timer all counting. The first time, one level-up is posed pending
// and the one tick that opens the overlay runs; the second time, a chest is
// posed under the lamplighter and the one tick that collects it runs. Sixty
// frames then run on each overlay, and the `run` after them must be the `run`
// the opening tick left, field for field: a build that keeps ticking under an
// overlay moves the moth, flies the bolt, counts a timer, or raises the clock,
// and any of those changes the run.
//
// Each overlay starts from its own pose. The level-up overlay is left by
// `choose` alone, which changes the loadout, so the chest is reached from a
// fresh isolated world rather than through the first overlay.
//
// TOLERANCE. None: "holds exactly the tick it was at" is a structural
// equality on the run, and sixty frames of the harness's clock is the span
// the review item names.
//
// The other overlay is `clock/chest-ticks-nothing`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { TICK_HZ } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";
import { poseLiveWorld } from "./live-world";

/** Frames run on the overlay: a second of the clock. */
const OVERLAY_FRAMES = TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds the world exactly where the opening tick left it on levelup", async () => {
  isolate(h);
  poseLiveWorld(h);
  const opened = await openLevelUp(h, 1);
  assertEqual(opened.screen, "levelup", "the screen the opening tick left");
  const held = await advanceTicks(h, OVERLAY_FRAMES);
  captureStill(h, "frozen");

  assertEqual(
    held.screen,
    "levelup",
    "the screen after sixty frames on levelup",
  );
  assertDeepEqual(
    held.run,
    opened.run,
    "the run after sixty frames on levelup, against the run the opening tick left",
  );
});
