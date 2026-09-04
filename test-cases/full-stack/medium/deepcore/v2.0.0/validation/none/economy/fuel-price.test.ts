// economy/fuel-price — the Fuel Depot's fixed increment costs what it says.
//
// `specs/gameplay.md` fixes both halves of one purchase: the increment is
// `FUEL_BUY_INCREMENT` (25) units and fuel costs `FUEL_PRICE` (1) Credit per
// unit, so the control adds 25 to the tank and takes 25 from the balance. The
// tank is posed part-empty with room for the whole increment, so what is read is
// the increment itself rather than a fill clipped by the maximum, and the
// balance is posed well above the price so the purchase is never refused for
// want of Credits — that refusal is `economy/unaffordable-refused`.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import { FUEL_BUY_INCREMENT, FUEL_PRICE, FUEL_TANK_MAX } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { openCamp } from "./camp";

/** The tank the increment is bought into, well clear of the tier-1 maximum. */
const FUEL_BEFORE = 40;

/** A balance the increment cannot exhaust. */
const CREDITS_BEFORE = 500;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("adds FUEL_BUY_INCREMENT fuel and takes FUEL_PRICE for each unit", async () => {
  await openCamp(h);
  await h.debug.setFuel(FUEL_BEFORE);
  await h.debug.setCredits(CREDITS_BEFORE);
  await h.debug.setPanel("fuel-depot");

  await h.debug.buyFuel();
  await h.advance(1);
  await captureStill(h, "buy");

  const after = await h.snapshot();
  assertCloseTo(
    after.miner.fuel,
    FUEL_BEFORE + FUEL_BUY_INCREMENT,
    6,
    "specs/gameplay.md",
  );
  assertEqual(
    after.credits,
    CREDITS_BEFORE - FUEL_BUY_INCREMENT * FUEL_PRICE,
    "specs/gameplay.md",
  );
  // The increment fits: the reading above is the whole of it rather than a
  // purchase the tier-1 maximum clipped (specs/upgrades.md).
  assertEqual(after.miner.maxFuel, FUEL_TANK_MAX[0], "specs/upgrades.md");
});
