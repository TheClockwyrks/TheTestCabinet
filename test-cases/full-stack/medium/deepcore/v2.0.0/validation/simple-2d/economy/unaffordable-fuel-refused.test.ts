// economy/unaffordable-fuel-refused — a fuel increment the balance cannot cover
// buys nothing.
//
// `specs/expedition.md` states it as a rule over every sink: "Credits never go
// negative, and an action that cannot be afforded is disabled." The failure modes
// that rule excludes are a partial purchase and a debt, so the Fuel Depot is posed
// one Credit short of `FUEL_BUY_INCREMENT * FUEL_PRICE` and both the fuel held and
// the balance are read back afterwards. One Credit short rather than none, because
// a build that refuses only at exactly zero would pass a probe posed at zero.
//
// The tank is left with room for the whole increment, so only the price can refuse
// it.

import { afterEach, beforeEach, it } from "vitest";
import { FUEL_BUY_INCREMENT, FUEL_PRICE } from "../constants";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { openCamp } from "./camp";

/** A tank with room for the whole increment, so only the price can refuse it. */
const FUEL_BEFORE = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a fuel increment one Credit short of its price", async () => {
  openCamp(h);
  const balance = FUEL_BUY_INCREMENT * FUEL_PRICE - 1;
  h.debug.setFuel(FUEL_BEFORE);
  h.debug.setCredits(balance);
  h.debug.setPanel("fuel-depot");

  h.debug.buyFuel();
  await h.advance(1);
  captureStill(h, "refused");

  const after = h.snapshot();
  assertEqual(after.miner.fuel, FUEL_BEFORE, "specs/expedition.md");
  assertEqual(after.credits, balance, "specs/expedition.md");
});
