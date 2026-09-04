// weight/climb-cap-scales — a heavier haul has a lower climb top speed.
//
// specs/character.md: while thrust is held the upward speed is capped at
// `climbCap = emptyClimb * (1 - (1 - CLIMB_CAP_FLOOR) * min(1, load))`, with
// `CLIMB_CAP_FLOOR` `0.58` and `emptyClimb` the jetpack tier's empty-load climb
// speed. So weight is felt the whole way up rather than only at the lift limit:
// a fully laden climb still runs at `58%` of an empty one.
//
// The climb is driven in the open sky over the camp, which specs/character.md
// leaves unbounded — a shaft deep enough to top out at every load would be most
// of a Standard mine, and the cap is what is being read rather than the ceiling.
// Eight seconds is held at each load, comfortably longer than the
// `climbCap / climbAccel` each one needs, so every reading is a settled speed
// rather than one still climbing toward the cap. The tank is filled before each
// climb, since a hold that ran the tank dry would report a jetpack that had
// stopped rather than a cap.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertGreaterThan } from "../assert";
import { JETPACK_EMPTY_CLIMB, SURFACE_Y, TILE, climbCapAt } from "../constants";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  loadToFraction,
  minerXOn,
  openScene,
  pinDrill,
  placeAt,
  stageTiers,
  type Harness,
} from "../harness";

/** A column well clear of the camp's buildings, and the height it starts at. */
const COL = 8;
const SKY_Y = SURFACE_Y - 15 * TILE;

/** The jetpack tier the climbs are driven at. */
const TIER = 1;
const EMPTY_CLIMB = JETPACK_EMPTY_CLIMB[TIER - 1];

/** The load fractions the cap is read at. */
const FRACTIONS = [0, 0.5, 0.9];

/** The climb, and the frames it is divided into. */
const HOLD_SECONDS = 8;
const FRAMES = 96;

/** How far a settled speed may sit from the cap, in units per second. */
const TOLERANCE = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("caps the climb speed lower the heavier the haul", async () => {
  await openScene(h);
  await stageTiers(h, { jetpack: TIER });
  await pinDrill(h);

  const runs = await captureReplay(h, "cap", async () => {
    const measured: { load: number; up: number }[] = [];
    for (const fraction of FRACTIONS) {
      const { fraction: load } = await loadToFraction(h, fraction);
      await placeAt(h, minerXOn(COL), SKY_Y);
      await h.debug.setFuel((await h.snapshot()).miner.maxFuel);

      await h.hold(ACTION_KEY.up);
      try {
        await h.advanceSeconds(HOLD_SECONDS, FRAMES);
      } finally {
        await h.release(ACTION_KEY.up);
      }
      const settled = await h.snapshot();
      // The tank still holds fuel, so the speed below is a cap rather than a
      // jetpack that ran out part-way up.
      assertGreaterThan(settled.miner.fuel, 0, "specs/character.md");
      measured.push({ load, up: -settled.miner.vy });
    }
    return measured;
  });

  for (const { load, up } of runs) {
    const cap = climbCapAt(EMPTY_CLIMB, load);
    assertBetween(
      up,
      cap - TOLERANCE,
      cap + TOLERANCE,
      `a load fraction of ${load.toFixed(3)} (specs/character.md)`,
    );
  }
});
