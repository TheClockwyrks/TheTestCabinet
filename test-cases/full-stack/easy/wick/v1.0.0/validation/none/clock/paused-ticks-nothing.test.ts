// clock/paused-ticks-nothing — the pause screen ticks nothing.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("What advances on each screen"):
// on `levelup`, `chest`, and `paused`, "Nothing. The world beneath holds
// exactly the tick it was at"; and of `paused` itself, "The world held still,
// with the HUD, under `PAUSED_TEXT`". specs/instrumentation.md, of `step`:
// "On every other screen the update ticks nothing ... and `run.tick` is
// untouched." What holds is the whole of `run`: `tick`, every enemy,
// projectile, zone, and gem, and every timer.
//
// THE DRIVE. The live night of `./stage`, run one tick so that everything in
// it is mid-motion, then paused through `setScreen("paused")`, which enters
// the screen "Exactly as `pause` does". Sixty frames then run on `paused`, and
// `run` is read against the state the pause left. A build that ticked under
// the pause moves the moth, the bolt, and the gem, and lowers the puddle's
// `ttl`, the contact cooldown, and Taper's timer.
//
// THE TOLERANCE. None: a world that ticked nothing holds identical numbers, so
// the comparison is `assertDeepEqual` over the whole of `run`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseScreen,
  type Harness,
} from "../harness";
import { poseLiveNight } from "./stage";

/** The frames run on the pause: a second of wall-clock frames. */
const HELD_FRAMES = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the world exactly where the pause left it across 60 frames", async () => {
  await poseLiveNight(h);
  await h.step(1);
  const paused = await poseScreen(h, "paused");
  const held = await h.step(HELD_FRAMES);
  await captureStill(h, "frozen");

  assertEqual(paused.screen, "paused", "the screen the pause entered");
  assertEqual(held.screen, "paused", "the screen after 60 frames on paused");
  assertDeepEqual(
    held.run,
    paused.run,
    "the run after 60 frames on paused, against the run the pause left",
  );
});
