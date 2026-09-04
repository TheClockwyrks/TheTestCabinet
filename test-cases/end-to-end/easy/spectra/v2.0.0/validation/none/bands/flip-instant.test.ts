// bands/flip-instant — the flip changes the ship's band in the frame it lands.
//
// specs/bands.md, on the flip: "The change is instant: the ship holds the other
// band in the frame the action is delivered." specs/controls.md binds the flip to
// the `b` action, reads it as a press edge, and lists it among the actions the
// `inWave` screen reads.
//
// The route is a real key through Chromium's input pipeline rather than a pose:
// specs/instrumentation.md carries no operation that flips ("A caller checking
// the flip drives the flip action and reads the band and the lockout back"), and
// `setShipBand` would grade the surface rather than the flip. `Harness.tap`
// presses the key, runs EXACTLY ONE frame with it held, and releases it, so the
// band is read after the single frame the press was delivered in — which is what
// "with no delay" means, and what a build that queues the flip for the next
// frame fails.
//
// The lockout the same flip starts is the sibling `bands/flip-starts-lockout`, so
// a build that changes band without locking the cannon, or locks it without
// changing band, fails the half it got wrong.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, opposite } from "../constants";
import {
  captureStill,
  createHarness,
  startPosed,
  type Harness,
} from "../harness";

/**
 * The key the flip is delivered on.
 *
 * The first of the three `specs/controls.md` binds to the `b` action. Which keys
 * are bound is graded by the `controls` category; this check needs one that is.
 */
const FLIP_KEY = BINDINGS.b[0];

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("holds the other band in the one frame the flip is delivered", async () => {
  await startPosed(harness);
  const before = await harness.snapshot();
  assertEqual(before.screen, "inWave", "the screen that reads the flip action");
  assertEqual(before.ship.band, "cyan", "the band the ship was posed on");

  await harness.tap(FLIP_KEY);
  const after = await harness.snapshot();
  await captureStill(harness, "flipped");

  assertEqual(
    after.ship.band,
    opposite(before.ship.band),
    "the ship's band in the frame the flip was delivered (specs/bands.md)",
  );
});
