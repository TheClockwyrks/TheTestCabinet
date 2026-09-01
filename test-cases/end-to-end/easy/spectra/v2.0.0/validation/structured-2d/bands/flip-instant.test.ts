// bands/flip-instant — the flip changes the ship's band in the frame it lands.
//
// specs/bands.md, "The flip": "The flip action changes the ship's band to the
// opposite one… The change is instant: the ship holds the other band in the frame
// the action is delivered." specs/controls.md binds the flip to the `b` action,
// reads it as a press edge, and lists it among the actions the `inWave` screen
// reads.
//
// THE ROUTE IS A REAL KEY, not a pose. specs/instrumentation.md is explicit:
// "There is no operation that flips and no operation that fires. A caller checking
// the flip drives the flip action and reads the band and the lockout back", so
// `setShipBand` would grade the surface rather than the flip. `Harness.tap`
// dispatches the key down and up and then runs EXACTLY ONE frame, which is the
// frame the engine's own input system delivers the press edge in — so the band is
// read after the single frame the action landed in. "With no delay" is exactly
// what a build that queues the flip for the following frame fails here.
//
// THE LOCKOUT the same flip starts is the sibling `bands.flip-starts-lockout`, so
// a build that changes band without locking the cannon, or locks it without
// changing band, fails the half it got wrong.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPosed,
  type Harness,
} from "../harness";

/**
 * The key the flip is delivered on.
 *
 * The first of the three keys specs/controls.md binds to the `b` action. WHICH
 * keys are bound is graded by the `controls` category; this point needs one that
 * is, and takes it from the same table the build was seeded with.
 */
const FLIP_KEY = BINDINGS.b[0];

/** The band `startPosed` leaves the ship on, and the one the flip must reach. */
const BEFORE = "cyan" as const;
const AFTER = "magenta" as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the other band in the one frame the flip is delivered", async () => {
  startPosed(h);

  const before = h.snapshot();
  assertEqual(before.screen, "inWave", "the screen that reads the flip action");
  assertEqual(before.ship.band, BEFORE, "the band the ship was posed on");

  await h.tap(FLIP_KEY);
  captureStill(h, "flipped");

  assertEqual(
    h.snapshot().ship.band,
    AFTER,
    `the ship's band in the one frame the ${FLIP_KEY} press was delivered in, ` +
      `the change being instant (specs/bands.md)`,
  );
});
