// economy/repair-price — hull repair costs REPAIR_PRICE a point, by the
// increment and to full.
//
// `specs/gameplay.md` fixes hull repair as `REPAIR_PRICE` (2) Credits per point,
// offered as a fixed `REPAIR_BUY_INCREMENT` (25) points and as a repair-to-full
// that pays only for the missing points and only as far as the Credits reach.
// The increment is bought into a hull with room for all 25 of it, then the
// remainder is repaired to full out of a balance that covers it, so the two
// prices are read one after the other off the same posed miner.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import { HULL_MAX, REPAIR_BUY_INCREMENT, REPAIR_PRICE } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { openCamp } from "./camp";

/** The hull the repair starts from, 60 points short of the tier-1 maximum. */
const HULL_BEFORE = 40;

/** A balance that covers both the increment and the repair to full. */
const CREDITS_BEFORE = 500;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("charges REPAIR_PRICE a point for the increment and for the fill", async () => {
  await openCamp(h);
  await h.debug.setHull(HULL_BEFORE);
  await h.debug.setCredits(CREDITS_BEFORE);
  await h.debug.setPanel("fuel-depot");

  await h.debug.buyRepair();
  const stepped = await h.snapshot();
  assertCloseTo(
    stepped.miner.hull,
    HULL_BEFORE + REPAIR_BUY_INCREMENT,
    6,
    "specs/gameplay.md",
  );
  assertEqual(
    stepped.credits,
    CREDITS_BEFORE - REPAIR_BUY_INCREMENT * REPAIR_PRICE,
    "specs/gameplay.md",
  );

  await h.debug.repairFull();
  await h.advance(1);
  await captureStill(h, "repair");

  const filled = await h.snapshot();
  const missing = HULL_MAX[0] - stepped.miner.hull;
  assertCloseTo(filled.miner.hull, HULL_MAX[0], 6, "specs/gameplay.md");
  assertEqual(
    filled.credits,
    stepped.credits - missing * REPAIR_PRICE,
    "specs/gameplay.md",
  );
});
