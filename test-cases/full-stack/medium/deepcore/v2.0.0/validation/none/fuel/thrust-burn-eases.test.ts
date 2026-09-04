// fuel/thrust-burn-eases — a fast climb burns at the cheaper cruise rate.
//
// specs/character.md: while thrust is held the burn is
// `THRUST_BURN_MAX + (THRUST_BURN_MIN - THRUST_BURN_MAX) * min(1, up / CRUISE_SPEED)`,
// so it eases from `5` fuel a second at a standstill to `THRUST_BURN_MIN` (`2`)
// at `CRUISE_SPEED` (`900`) upward and stays there above it. A light fast ascent
// is cheaper per second than a slow grinding one.
//
// The upward speed is posed and the miner's body held still, so it stays exactly
// where it was posed for the whole hold and each reading falls at one named point
// on the curve: half of `CRUISE_SPEED`, `CRUISE_SPEED` itself, and half again
// above it, which is where the `min` clamps. In the open sky there is no life
// support on the meter and with nothing held laterally there is no air burn, so
// each spend is the thrust burn alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual } from "../assert";
import {
  CRUISE_SPEED,
  THRUST_BURN_SIZE_MULT,
  thrustBurnAt,
} from "../constants";
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
import { standInSky } from "./sky";

/** A column well clear of the camp's buildings. */
const COL = 8;

/** How long thrust is held at each speed, in seconds. */
const HOLD_SECONDS = 1;

/** The upward speeds the curve is read at. */
const SPEEDS = [CRUISE_SPEED / 2, CRUISE_SPEED, CRUISE_SPEED * 1.5];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("eases the thrust burn toward THRUST_BURN_MIN as the climb quickens", async () => {
  await openScene(h);
  await standInSky(h, COL);
  await pinMiner(h);
  await pinDrill(h);

  const spends = await captureReplay(h, "cruise", async () => {
    const measured: { up: number; spent: number }[] = [];
    for (const up of SPEEDS) {
      await h.debug.setFuel((await h.snapshot()).miner.maxFuel);
      // Positive `vy` is downward, so an upward speed is posed negative.
      await h.debug.setMinerVelocity(0, -up);
      const before = await h.snapshot();
      await h.hold(ACTION_KEY.up);
      try {
        await h.advance(HOLD_SECONDS * TICK_HZ);
      } finally {
        await h.release(ACTION_KEY.up);
      }
      const after = await h.snapshot();
      assertEqual(after.miner.vy, -up, "specs/instrumentation.md");
      measured.push({ up, spent: before.miner.fuel - after.miner.fuel });
    }
    return measured;
  });

  for (const { up, spent } of spends) {
    const rate = thrustBurnAt(up) * THRUST_BURN_SIZE_MULT.standard;
    const tolerance = (2 * rate) / TICK_HZ;
    assertBetween(
      spent,
      rate * HOLD_SECONDS - tolerance,
      rate * HOLD_SECONDS + tolerance,
      `an upward speed of ${up} (specs/character.md)`,
    );
  }
});
