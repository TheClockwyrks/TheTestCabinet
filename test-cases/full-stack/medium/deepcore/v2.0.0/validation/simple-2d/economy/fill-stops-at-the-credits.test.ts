// economy/fill-stops-at-the-credits — a thin balance buys a partial fill.
//
// `specs/gameplay.md` fixes fill-to-full as buying only as far as the Credits
// reach, so a miner with 20 Credits and a tank 60 units short leaves with 20
// more fuel and a balance of 0. The two failure modes this separates are a
// refusal (nothing bought, the balance untouched) and a debt (the tank full and
// the balance negative), so both the fuel gained and the balance are read.

import { afterEach, beforeEach, it } from "vitest";
import { FUEL_PRICE, FUEL_TIERS } from "../../src/constants";
import { assertCloseTo, assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { openCamp } from "./camp";

/** The tank the fill starts from, 60 units short of the tier-1 maximum. */
const FUEL_BEFORE = 40;

/** A balance that covers 20 of those 60 units and no more. */
const CREDITS_BEFORE = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("buys as much fuel as the Credits cover and leaves the balance at 0", async () => {
  openCamp(h);
  h.debug.setFuel(FUEL_BEFORE);
  h.debug.setCredits(CREDITS_BEFORE);
  h.debug.setPanel("fuel-depot");

  h.debug.fillFuel();
  await h.advance(1);
  captureStill(h, "short");

  const after = h.snapshot();
  const affordable = CREDITS_BEFORE / FUEL_PRICE;
  assertCloseTo(
    after.miner.fuel,
    FUEL_BEFORE + affordable,
    6,
    "specs/gameplay.md",
  );
  assertEqual(after.credits, 0, "specs/gameplay.md");
  // And the fill really was short of full, so the reading above is the Credits
  // ceiling rather than a tank that happened to fit inside the balance.
  assertCloseTo(after.miner.maxFuel, FUEL_TIERS[0], 6, "specs/upgrades.md");
});
