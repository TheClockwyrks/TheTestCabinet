// bands/flip-starts-lockout — a flip starts the fire lockout.
//
// specs/bands.md: "The flip starts a fire lockout of `FLIP_LOCKOUT` (`0.30`)
// seconds, during which the ship cannot fire", and specs/ship.md carries the same
// figure in the table of what blocks a shot. This check reads the lockout the
// flip STARTS — the figure — and nothing about what the lockout then does to the
// cannon, which is the `ship` category's.
//
// The flip is delivered as a real press, because specs/instrumentation.md carries
// no operation that flips: `setFireLockout` poses the lockout and would grade the
// surface rather than the flip. The ship is posed with its lockout at zero by
// `startPosed`, so the reading is the whole of what the flip put there.
//
// The tolerance is the review item's own: within 10% of `FLIP_LOCKOUT`. It is
// wide enough to cover the one frame of game time `Harness.tap` runs while the
// key is held — 0.01 s of the harness's 100 Hz clock, which a build that counts
// the lockout down inside that same frame will already have spent — and far too
// narrow to admit a build that started `FIRE_INTERVAL` (0.16) or twice the
// lockout instead.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual } from "../assert";
import { BINDINGS, FLIP_LOCKOUT } from "../constants";
import {
  captureStill,
  createHarness,
  startPosed,
  type Harness,
} from "../harness";

/** The key the flip is delivered on: the first `specs/controls.md` binds to `b`. */
const FLIP_KEY = BINDINGS.b[0];

/** The review item's tolerance on the lockout the flip starts: within 10%. */
const LOCKOUT_TOLERANCE = 0.1;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("sets the fire lockout to FLIP_LOCKOUT", async () => {
  await startPosed(harness);
  const before = await harness.snapshot();
  assertEqual(before.screen, "inWave", "the screen that reads the flip action");
  assertEqual(before.ship.lockout, 0, "the lockout the ship was posed with");

  await harness.tap(FLIP_KEY);
  const after = await harness.snapshot();
  await captureStill(harness, "lockout");

  assertBetween(
    after.ship.lockout,
    FLIP_LOCKOUT * (1 - LOCKOUT_TOLERANCE),
    FLIP_LOCKOUT * (1 + LOCKOUT_TOLERANCE),
    "the seconds of fire lockout the flip started (specs/bands.md)",
  );
});
