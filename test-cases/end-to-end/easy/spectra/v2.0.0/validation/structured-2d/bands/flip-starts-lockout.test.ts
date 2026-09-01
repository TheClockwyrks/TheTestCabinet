// bands/flip-starts-lockout — a flip starts the fire lockout.
//
// specs/bands.md, "The flip": "The flip starts a fire lockout of `FLIP_LOCKOUT`
// (`0.30`) seconds, during which the ship cannot fire", and specs/ship.md carries
// the same figure in its table of what blocks a shot. This point reads the figure
// the flip PUTS THERE and nothing about what the lockout then does to the cannon,
// which is the `ship` category's.
//
// THE FLIP IS A REAL PRESS, because specs/instrumentation.md carries no operation
// that flips: `setFireLockout` poses the lockout and would grade the surface
// rather than the flip. `startPosed` leaves the ship's lockout at `0`, which the
// check reads first, so what is measured afterwards is the whole of what the flip
// put there and not a remainder of something else.
//
// THE TOLERANCE IS THE REVIEW ITEM'S OWN: within 10% of `FLIP_LOCKOUT`. It is wide
// enough to cover the one frame of game time `Harness.tap` runs while the key is
// down — 0.01 s of the harness's 100 Hz clock, which a build that counts the
// lockout down inside that same frame will already have spent — and far too narrow
// to admit a build that started `FIRE_INTERVAL` (`0.16`, specs/ship.md) or twice
// the lockout instead.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, FLIP_LOCKOUT } from "../../src/constants";
import { assertBetween, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPosed,
  type Harness,
} from "../harness";

/** The key the flip is delivered on: the first specs/controls.md binds to `b`. */
const FLIP_KEY = BINDINGS.b[0];

/** The review item's tolerance on the lockout the flip starts: within 10%. */
const LOCKOUT_TOLERANCE = 0.1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sets the fire lockout to FLIP_LOCKOUT", async () => {
  startPosed(h);

  const before = h.snapshot();
  assertEqual(before.screen, "inWave", "the screen that reads the flip action");
  assertEqual(before.ship.lockout, 0, "the lockout the ship was posed with");

  await h.tap(FLIP_KEY);
  captureStill(h, "lockout");

  assertBetween(
    h.snapshot().ship.lockout,
    FLIP_LOCKOUT * (1 - LOCKOUT_TOLERANCE),
    FLIP_LOCKOUT * (1 + LOCKOUT_TOLERANCE),
    `the seconds of fire lockout the flip started, FLIP_LOCKOUT ` +
      `${FLIP_LOCKOUT} within ${LOCKOUT_TOLERANCE * 100}% (specs/bands.md)`,
  );
});
