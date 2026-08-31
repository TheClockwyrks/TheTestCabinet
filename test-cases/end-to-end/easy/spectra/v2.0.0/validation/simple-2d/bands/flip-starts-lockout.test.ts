// bands/flip-starts-lockout — the flip starts the fire lockout.
//
// specs/bands.md, "The flip": "The flip starts a fire lockout of `FLIP_LOCKOUT`
// (`0.30`) seconds, during which the ship cannot fire", and specs/ship.md states
// the same figure in its gate table — "The fire lockout is at zero. A flip sets
// it to `FLIP_LOCKOUT` (`0.30`) seconds, and it counts down with game time".
// specs/instrumentation.md reports what stands as `ship.lockout`, "seconds of
// post-flip fire lockout left".
//
// SO THE CHECK READS ONE NUMBER, one frame after one press: the lockout the flip
// set. What the lockout DOES to the cannon — that a shot inside it adds nothing —
// is specs/ship.md's rule and the `ship` group's point; nothing here fires.
//
// THE ACTION IS DELIVERED THROUGH THE REAL BINDING, not posed. `setFireLockout`
// would make this a tautology: it is the operation that POSES a lockout, and the
// requirement is that the game's own flip starts one.
//
// THE LOCKOUT OPENS AT ZERO. `startPosed` leaves it there, so what is read after
// the tap is what this flip set and not the remains of an earlier one.
//
// THE TOLERANCE IS THE REVIEW ITEM'S OWN: within 10% of `FLIP_LOCKOUT`. The
// single frame that delivers the edge is 1/120 of a second of game time, so a
// build that counts that frame down before reporting reads `0.2917` and a build
// that counts it after reads `0.3000`; both are the same rule, and both sit
// inside a band of ±`0.03`. A band that wide still separates the figure from
// every other duration this game carries.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, FLIP_LOCKOUT } from "../../src/constants";
import { assertBetween } from "../assert";
import {
  captureStill,
  createHarness,
  startPosed,
  type Harness,
} from "../harness";

/** The key bound to the flip action `b` (specs/controls.md, `BINDINGS`). */
const FLIP_KEY = BINDINGS.b[0];

/** The review item's own tolerance on the figure: within 10%. */
const TOLERANCE = 0.1 * FLIP_LOCKOUT;
const LOCKOUT_MIN = FLIP_LOCKOUT - TOLERANCE;
const LOCKOUT_MAX = FLIP_LOCKOUT + TOLERANCE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves FLIP_LOCKOUT seconds of lockout standing after a flip", async () => {
  startPosed(h);
  h.debug.setFireLockout(0);

  await h.tap(FLIP_KEY);
  captureStill(h, "lockout");

  assertBetween(
    h.snapshot().ship.lockout,
    LOCKOUT_MIN,
    LOCKOUT_MAX,
    `the seconds of fire lockout standing one frame after ${FLIP_KEY} was ` +
      `pressed and released, from a lockout of 0 — specs/bands.md: a flip ` +
      `starts a fire lockout of FLIP_LOCKOUT ${FLIP_LOCKOUT} seconds. 0 is a ` +
      "flip that started none",
  );
});
