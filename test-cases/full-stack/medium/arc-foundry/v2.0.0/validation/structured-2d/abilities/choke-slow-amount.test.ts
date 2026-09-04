// abilities/choke-slow-amount — the Choke's hit sets the slow the tier gives.
//
// specs/components.md fixes the amount per tier: `CHOKE_SLOW` holds `0.22` at
// Scrap rising `0.03` a tier to `0.34`. specs/enemies.md fixes what an applied
// slow does: "Applying a slow of amount `amt` at time `now` for `dur` seconds
// sets `slowFactor = min(slowFactor, 1 - amt)`", and "While `now < slowUntil` the
// unit moves at `baseSpeed * slowFactor`". specs/instrumentation.md reports
// `speed` as "current speed, after any slow" and `baseSpeed` as "the roster
// speed", so both ends of that sentence are readable.
//
// One Choke and one held unit at each of the five tiers, on a yard emptied between
// them. The unit's travel is held and nothing else is: a held unit "keeps every
// faculty but travel", so its slow is applied, runs and is reported exactly as it
// would be on a walking unit, and the reading is not competing with the unit
// leaving the radius. The wave is deep enough that no tier's hit can kill it.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { CHOKE_SLOW, TIERS } from "../constants";
import {
  captureReplay,
  createHarness,
  emptyYard,
  type Harness,
  openYard,
  parkUnit,
  standComponent,
  structureById,
  unitById,
} from "../harness";
import { awaitEffect } from "./impact";

const ANCHOR = { col: 10, row: 10 };

/** Inside the Scrap Choke's `104`, and so inside every tier's. */
const TARGET_RANGE = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("sets slowFactor to 1 - CHOKE_SLOW[tier] and the speed that follows from it", async () => {
  openYard(h, { wave: 5 });

  await captureReplay(h, "slow", async () => {
    for (const tier of TIERS) {
      emptyYard(h);
      const id = standComponent(h, "choke", tier, ANCHOR.col, ANCHOR.row);
      const structure = structureById(h.snapshot(), id);
      const target = parkUnit(h, "dynamo", {
        x: structure.cx + TARGET_RANGE,
        y: structure.cy,
      });

      const struck = await awaitEffect(
        h,
        target,
        (unit) => unit.slowFactor < 1,
      );
      const unit = unitById(struck, target);
      const expected = 1 - CHOKE_SLOW[tier - 1]!;
      assertCloseTo(
        unit.slowFactor,
        expected,
        6,
        `slowFactor after a tier ${tier} Choke's hit, whose slow amount is ` +
          `${CHOKE_SLOW[tier - 1]!} (specs/components.md)`,
      );
      assertCloseTo(
        unit.speed,
        unit.baseSpeed * expected,
        6,
        `the speed a unit slowed by a tier ${tier} Choke reports, against its ` +
          `roster speed times that factor (specs/enemies.md)`,
      );
    }
  });
});
