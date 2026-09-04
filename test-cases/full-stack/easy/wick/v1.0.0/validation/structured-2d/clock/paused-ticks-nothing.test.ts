// Wick — clock/paused-ticks-nothing: the pause screen ticks nothing.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/overview.md` ("Units, ticks, the world, and the camera"): "Only
//     the `playing` screen ticks; the level-up and chest overlays and every
//     other screen tick nothing".
//   - `specs/ui.md` (the screen table): "`levelup`, `chest`, `paused` |
//     Nothing. The world beneath holds exactly the tick it was at." And of
//     `paused`: "The world held still, with the HUD, under `PAUSED_TEXT`".
//   - `specs/instrumentation.md` (`setScreen`, `paused` from `playing`):
//     "Exactly as `pause` does; the accumulator is discarded as on any frame
//     that leaves `playing`."
//
// THE DRIVE. From an isolated run, the live world of `live-world.ts` is posed
// with every switch on: a moth chasing, a bolt flying, a puddle and the bolt
// with `ttl` counting, a contact cooldown, Ember's cooldown, and the
// director's timer all counting. One tick runs so everything is in motion,
// then the run is paused through the surface. Sixty frames run on `paused`,
// and the `run` after them must be the `run` the pause left, field for field:
// a build whose pause keeps ticking moves the moth, flies the bolt, counts a
// timer, or raises the clock, and any of those changes the run.
//
// TOLERANCE. None: "holds exactly the tick it was at" is a structural
// equality on the run, and sixty frames of the harness's clock is the span
// the review item names.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { TICK_HZ } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  poseScreen,
  type Harness,
} from "../harness";
import { poseLiveWorld } from "./live-world";

/** Frames run on the pause screen: a second of the clock. */
const PAUSED_FRAMES = TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds the world exactly where the pause left it across sixty frames", async () => {
  isolate(h);
  poseLiveWorld(h);
  await advanceTicks(h, 1);
  const pausedAt = poseScreen(h, "paused");
  assertEqual(pausedAt.screen, "paused", "the screen the pause left");

  const after = await advanceTicks(h, PAUSED_FRAMES);
  captureStill(h, "frozen");

  assertEqual(
    after.screen,
    "paused",
    "the screen after sixty frames on paused",
  );
  assertDeepEqual(
    after.run,
    pausedAt.run,
    "the run after sixty frames on paused, against the run the pause left",
  );
});
