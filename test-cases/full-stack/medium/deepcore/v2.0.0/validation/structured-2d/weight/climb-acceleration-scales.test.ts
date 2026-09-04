// weight/climb-acceleration-scales — a heavier haul climbs away more slowly.
//
// specs/character.md: while thrust is held the net vertical acceleration is
// `climbAccel = emptyAccel * max(0, 1 - load)` upward, where `emptyAccel` is the
// jetpack tier's empty-load climb acceleration, and "gravity contributes nothing
// further while thrust is held". So a miner at half the lift limit climbs away at
// half the empty acceleration, and the reading is the speed a short hold from
// rest reaches.
//
// The miner is posed at rest in the open sky over the camp, which
// specs/character.md leaves unbounded and where fuel is spent exactly as it is
// below: nothing is in the way of a climb up there, and no life-support trickle
// runs behind the reading. The hold is a quarter of a second at each load, which
// is long enough for the acceleration to show and far short of the `climbCap`
// that would flatten it — that cap is the sibling check's subject.
//
// The load is posed in whole units of one ore, because a bay holds units rather
// than kilograms, and each expected acceleration is computed from the fraction
// the game reports rather than from the one that was asked for.

import { afterEach, beforeEach, it } from "vitest";
import { JETPACK_TIERS, SURFACE_Y, TILE } from "../../src/constants";
import { assertBetween, assertLessThan } from "../assert";
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
  TICK_HZ,
  type Harness,
} from "../harness";
import { climbAccelAt, climbCapAt } from "./climb";

/** A column well clear of the camp's buildings, and the height it starts at. */
const COL = 8;
const SKY_Y = SURFACE_Y - 15 * TILE;

/** The jetpack tier the climbs are driven at. */
const TIER = 3;
const EMPTY_ACCEL = JETPACK_TIERS[TIER - 1].emptyAccel;
const EMPTY_CLIMB = JETPACK_TIERS[TIER - 1].emptyClimb;

/** The load fractions the acceleration is read at. */
const FRACTIONS = [0, 0.25, 0.5, 0.75];

/** How long thrust is held from rest. */
const HOLD_FRAMES = TICK_HZ / 4;
const HOLD_SECONDS = HOLD_FRAMES / TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("scales the climb acceleration by the load the miner carries", async () => {
  openScene(h);
  stageTiers(h, { jetpack: TIER });
  pinDrill(h);

  const runs = await captureReplay(h, "accel", async () => {
    const measured: { load: number; vy: number }[] = [];
    for (const fraction of FRACTIONS) {
      const { fraction: load } = loadToFraction(h, fraction);
      placeAt(h, minerXOn(COL), SKY_Y);
      h.debug.setFuel(h.snapshot().miner.maxFuel);

      h.hold(ACTION_KEY.up);
      try {
        await h.advance(HOLD_FRAMES);
      } finally {
        h.release(ACTION_KEY.up);
      }
      measured.push({ load, vy: h.snapshot().miner.vy });
    }
    return measured;
  });

  for (const { load, vy } of runs) {
    const accel = climbAccelAt(EMPTY_ACCEL, load);
    const reached = accel * HOLD_SECONDS;
    // Far short of the cap, so what is read is the acceleration alone.
    assertLessThan(
      reached,
      climbCapAt(EMPTY_CLIMB, load),
      "specs/character.md",
    );
    // One frame of the acceleration, and a unit for the speed a build may bill
    // the frame the key went down on.
    const tolerance = accel / TICK_HZ + 1;
    // Positive `vy` is downward, so a climb reads negative.
    assertBetween(
      -vy,
      reached - tolerance,
      reached + tolerance,
      `a load fraction of ${load.toFixed(3)} (specs/character.md)`,
    );
  }
});
