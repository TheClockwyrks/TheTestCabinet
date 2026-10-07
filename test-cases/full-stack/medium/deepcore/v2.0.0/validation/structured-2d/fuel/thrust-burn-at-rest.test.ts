// fuel/thrust-burn-at-rest — lift-off burns at the full thrust rate.
//
// specs/character.md: while thrust is held the burn is
// `THRUST_BURN_MAX + (THRUST_BURN_MIN - THRUST_BURN_MAX) * min(1, up / CRUISE_SPEED)`,
// where `up` is the miner's upward speed, then multiplied by the world size's
// `THRUST_BURN_SIZE_MULT` — `1` at the Standard size a fresh expedition opens at.
// At an upward speed of `0` that is `THRUST_BURN_MAX` (`5`) fuel per second, so
// lifting off from a stop is the most expensive part of a climb.
//
// The miner is posed in the open sky and its body held still, so its upward speed
// stays the `0` it was posed at for the whole hold and the rate is read at the
// one point the sentence above names. Above the ground line there is no life
// support on the meter, and with nothing held laterally there is no air burn, so
// the fuel spent is the thrust burn alone.

import { afterEach, beforeEach, it } from "vitest";
import { THRUST_BURN_SIZE_MULT } from "../constants";
import { assertBetween, assertEqual } from "../assert";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  openScene,
  pinDrill,
  pinMiner,
  TICK_HZ,
  type Harness,
} from "../harness";
import { thrustBurnAt } from "./burn";
import { standInSky } from "./sky";

/** A column well clear of the camp's buildings. */
const COL = 8;

/** How long thrust is held, in seconds. */
const HOLD_SECONDS = 2;

/** The rate the specification's formula gives at an upward speed of zero. */
const RATE = thrustBurnAt(0) * THRUST_BURN_SIZE_MULT.standard;

/** The spend, and the two frames of it a build may bill either side of the hold. */
const EXPECTED = RATE * HOLD_SECONDS;
const TOLERANCE = (2 * RATE) / TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("spends THRUST_BURN_MAX a second while thrusting from a stop", async () => {
  openScene(h);
  standInSky(h, COL);
  pinMiner(h);
  pinDrill(h);

  const before = h.snapshot();
  assertEqual(before.worldSize, "standard", "specs/expedition.md");
  assertEqual(before.miner.vy, 0, "specs/instrumentation.md");

  const after = await captureReplay(h, "liftoff", async () => {
    h.hold(ACTION_KEY.up);
    try {
      await h.advance(HOLD_SECONDS * TICK_HZ);
      return h.snapshot();
    } finally {
      h.release(ACTION_KEY.up);
    }
  });

  // Held still, so the whole hold ran at an upward speed of zero.
  assertEqual(after.miner.vy, 0, "specs/instrumentation.md");
  assertBetween(
    before.miner.fuel - after.miner.fuel,
    EXPECTED - TOLERANCE,
    EXPECTED + TOLERANCE,
    "specs/character.md",
  );
});
