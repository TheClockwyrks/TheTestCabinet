// abilities/rectifier-burn-duration — the burn runs its span and stops dead.
//
// specs/components.md fixes the span: the Rectifier's hit applies its burn "for
// `RECTIFIER_BURN_DUR` (`2.0`) seconds". specs/enemies.md fixes the boundary:
// health is lost only "While `now < burnUntil`". So a burn that never expires
// turns one Rectifier into an eventual kill on anything, which is why the end of
// the burn is a point of its own rather than part of the rate.
//
// The Rectifier is taken off the yard the moment its shot lands, so nothing can
// refresh the burn while its span is being measured. Two readings decide it:
// `burnUntil` sits one duration past the hit, and the unit's health does not move
// at all over the seconds that follow.
//
// THE CLOCK IS THE CHECK'S. The frames here are spent sitting out a duration
// rather than reading one, and specs/instrumentation.md guarantees that "an
// interval of simulation time reaches the same state however it was divided into
// frames and whatever frame rate produced it", so the durations are sat out at
// `WATCH_HZ`. That rate is chosen against `STAMP_SLACK` below: one frame of it is
// a third of the slack the stamp is read within, so the frame the burn is first
// seen on dates the hit well inside that tolerance.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual, assertGreaterThan } from "../assert";
import { RECTIFIER_BURN_DUR } from "../constants";
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

/** Inside the Charged Rectifier's `112`. */
const TARGET_RANGE = 60;

/** The tier the span is read at. */
const TIER = 3;

/** The rate the two spans are sat out at. */
const WATCH_HZ = 60;

/** How long past the expiry the health is watched, in seconds. */
const AFTER = 2;

/** A margin past the expiry before the watching starts. */
const MARGIN = 0.5;

/** How far `burnUntil` may sit from the moment the burn was first seen. */
const STAMP_SLACK = 0.05;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ hz: WATCH_HZ });
});

afterEach(() => {
  h.dispose();
});

it("stops taking health the moment RECTIFIER_BURN_DUR has run", async () => {
  openYard(h, { wave: 1 });
  const id = standComponent(h, "rectifier", TIER, ANCHOR.col, ANCHOR.row);
  const structure = structureById(h.snapshot(), id);
  const target = parkUnit(h, "dynamo", {
    x: structure.cx + TARGET_RANGE,
    y: structure.cy,
  });

  const expired = await captureReplay(h, "expiry", async () => {
    const struck = await awaitEffect(h, target, (unit) => unit.burnDps > 0);
    // Nothing may refresh the burn while its own span is being measured.
    h.debug.clearStructures();
    h.debug.clearProjectiles();

    const hitAt = struck.simTime;
    const opened = unitById(struck, target);
    await h.advanceSeconds(RECTIFIER_BURN_DUR + MARGIN);
    const settled = unitById(h.snapshot(), target);
    await h.advanceSeconds(AFTER);
    return {
      hitAt,
      until: opened.burnUntil,
      opened,
      settled,
      later: unitById(h.snapshot(), target),
    };
  });

  assertBetween(
    expired.until,
    expired.hitAt + RECTIFIER_BURN_DUR - STAMP_SLACK,
    expired.hitAt + RECTIFIER_BURN_DUR + STAMP_SLACK,
    `burnUntil against the simulation clock at the hit plus ` +
      `RECTIFIER_BURN_DUR (${RECTIFIER_BURN_DUR}s) (specs/components.md)`,
  );
  // The burn really did run, so this is not a check that passes because nothing
  // ever happened.
  assertGreaterThan(
    expired.opened.hp - expired.settled.hp,
    0,
    "the health the burn removed while it was running",
  );
  assertEqual(
    expired.later.hp,
    expired.settled.hp,
    `the unit's health over the ${AFTER}s after the burn expired ` +
      `(specs/enemies.md)`,
  );
});
