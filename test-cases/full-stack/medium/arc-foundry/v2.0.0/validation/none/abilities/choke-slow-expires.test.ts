// abilities/choke-slow-expires — the slow runs out and the unit recovers.
//
// specs/components.md fixes the duration: "The Choke's hit applies a slow for
// `CHOKE_SLOW_DUR` (`1.2`) seconds." specs/enemies.md fixes what happens at the
// end of it: "Once `slowUntil` passes, `slowFactor` returns to `1`", and while it
// has not passed the unit moves at the reduced speed.
//
// The Choke is taken off the yard the moment its shot lands, because it fires
// again every three-quarters of a second and "a fresh hit refreshes the duration"
// — so a check that left it standing would be measuring the cadence rather than
// the duration. What is read is three things: `slowUntil` sits one duration past
// the hit, the unit is still slowed a little before that moment, and its factor is
// back at exactly `1` and its speed back at its roster speed a little after it.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertCloseTo, assertEqual } from "../assert";
import { CHOKE_SLOW, CHOKE_SLOW_DUR } from "../constants";
import {
  captureReplay,
  createHarness,
  openYard,
  parkUnit,
  standComponent,
  structureById,
  unitById,
  type Harness,
} from "../harness";
import { awaitEffect } from "./impact";

const ANCHOR = { col: 10, row: 10 };

/** Inside the Scrap Choke's `104`. */
const TARGET_RANGE = 60;

/** The tier the duration is read at. */
const TIER = 1;

/** How far either side of the expiry the unit is sampled, in seconds. */
const EITHER_SIDE = 0.2;

/**
 * How far `slowUntil` may sit from the moment the hit was first seen.
 *
 * The check samples every frame of its own clock, and a build is free to run its
 * simulation in whole internal steps, so the frame the slow is first VISIBLE on
 * can sit a little past the update that applied it.
 */
const STAMP_SLACK = 0.05;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the slow to the end of CHOKE_SLOW_DUR and then returns it to 1", async () => {
  await openYard(h, { wave: 5 });
  const id = await standComponent(h, "choke", TIER, ANCHOR.col, ANCHOR.row);
  const structure = structureById(await h.snapshot(), id);
  const target = await parkUnit(h, "dynamo", {
    x: structure.cx + TARGET_RANGE,
    y: structure.cy,
  });

  const recovered = await captureReplay(h, "expiry", async () => {
    const struck = await awaitEffect(h, target, (unit) => unit.slowFactor < 1);
    const hitAt = struck.simTime;
    const slowed = unitById(struck, target);

    // Nothing may refresh the slow while its own duration is being measured.
    await h.debug.clearStructures();
    await h.debug.clearProjectiles();

    await h.advanceSeconds(CHOKE_SLOW_DUR - EITHER_SIDE);
    const before = unitById(await h.snapshot(), target);
    await h.advanceSeconds(2 * EITHER_SIDE);
    const after = unitById(await h.snapshot(), target);
    return { hitAt, slowed, before, after };
  });

  assertBetween(
    recovered.slowed.slowUntil,
    recovered.hitAt + CHOKE_SLOW_DUR - STAMP_SLACK,
    recovered.hitAt + CHOKE_SLOW_DUR + STAMP_SLACK,
    `slowUntil against the simulation clock at the hit plus ` +
      `CHOKE_SLOW_DUR (${CHOKE_SLOW_DUR}s) (specs/components.md)`,
  );
  assertCloseTo(
    recovered.before.slowFactor,
    1 - CHOKE_SLOW[TIER - 1]!,
    6,
    `slowFactor ${EITHER_SIDE}s before the slow was due to expire`,
  );
  assertEqual(
    recovered.after.slowFactor,
    1,
    `slowFactor ${EITHER_SIDE}s after the slow expired (specs/enemies.md)`,
  );
  assertCloseTo(
    recovered.after.speed,
    recovered.after.baseSpeed,
    6,
    "the speed the unit recovered once the slow expired",
  );
});
