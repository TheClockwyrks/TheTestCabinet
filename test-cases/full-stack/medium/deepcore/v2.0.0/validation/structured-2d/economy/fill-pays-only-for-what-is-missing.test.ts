// economy/fill-pays-only-for-what-is-missing — fill-to-full charges the shortfall.
//
// `specs/expedition.md` fixes fill-to-full as paying `FUEL_PRICE` for each unit the
// tank is short and no more, so a tank at 40 of 100 costs 60 Credits. The
// balance is posed far above that shortfall, so what the check reads is the
// price of the missing fuel rather than the ceiling the Credits impose — the
// Credits ceiling is the sibling point `economy/fill-stops-at-the-credits`.

import { afterEach, beforeEach, it } from "vitest";
import { FUEL_PRICE, FUEL_TIERS } from "../constants";
import { assertCloseTo, assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { openCamp } from "./camp";

/** The tank the fill starts from, 60 units short of the tier-1 maximum. */
const FUEL_BEFORE = 40;

/** A balance far above the shortfall, so nothing here is capped by Credits. */
const CREDITS_BEFORE = 500;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("fills the tank and charges FUEL_PRICE for each missing unit only", async () => {
  openCamp(h);
  h.debug.setFuel(FUEL_BEFORE);
  h.debug.setCredits(CREDITS_BEFORE);
  h.debug.setPanel("fuel-depot");

  h.debug.fillFuel();
  await h.advance(1);
  captureStill(h, "fill");

  const after = h.snapshot();
  const missing = FUEL_TIERS[0] - FUEL_BEFORE;
  assertCloseTo(after.miner.fuel, FUEL_TIERS[0], 6, "specs/expedition.md");
  assertEqual(
    after.credits,
    CREDITS_BEFORE - missing * FUEL_PRICE,
    "specs/expedition.md",
  );
});
