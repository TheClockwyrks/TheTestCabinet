// economy/unaffordable-refused — a purchase the balance cannot cover buys
// nothing.
//
// `specs/gameplay.md` states it as a rule over every sink: "Credits never go
// negative, and an action that cannot be afforded is disabled." The failure
// modes that rule excludes are a partial purchase and a debt, so each probe is
// posed one Credit short of a price and both the thing bought and the balance
// are read back afterwards. One Credit short rather than none, because a build
// that refuses only at exactly zero would pass a probe posed at zero.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  FUEL_BUY_INCREMENT,
  FUEL_PRICE,
  ITEM_PRICES,
  UPGRADE_PRICES,
} from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { openCamp } from "./camp";

/** A tank with room for the whole increment, so only the price can refuse it. */
const FUEL_BEFORE = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses an upgrade one Credit short of its price", async () => {
  await openCamp(h);
  const balance = UPGRADE_PRICES[2] - 1;
  await h.debug.setCredits(balance);
  await h.debug.setPanel("upgrade-shop");

  await h.debug.buyUpgrade("cargo");
  await h.advance(1);
  await captureStill(h, "refused");

  const after = await h.snapshot();
  assertEqual(after.tiers.cargo, 1, "specs/gameplay.md");
  assertEqual(after.credits, balance, "specs/gameplay.md");
});

it("refuses a field supply one Credit short of its price", async () => {
  await openCamp(h);
  const balance = ITEM_PRICES.dynamite - 1;
  await h.debug.setCredits(balance);
  await h.debug.setPanel("supply-depot");

  await h.debug.buyItem("dynamite");

  const after = await h.snapshot();
  assertEqual(after.items.dynamite, 0, "specs/items.md");
  assertEqual(after.credits, balance, "specs/gameplay.md");
});

it("refuses a fuel increment one Credit short of its price", async () => {
  await openCamp(h);
  const balance = FUEL_BUY_INCREMENT * FUEL_PRICE - 1;
  await h.debug.setFuel(FUEL_BEFORE);
  await h.debug.setCredits(balance);
  await h.debug.setPanel("fuel-depot");

  await h.debug.buyFuel();

  const after = await h.snapshot();
  assertEqual(after.miner.fuel, FUEL_BEFORE, "specs/gameplay.md");
  assertEqual(after.credits, balance, "specs/gameplay.md");
});
