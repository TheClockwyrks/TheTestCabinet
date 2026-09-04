// economy/unaffordable-fuel-refused — a fuel increment beyond the balance buys
// nothing.
//
// `specs/expedition.md` states it as a rule over every sink: "Credits never go
// negative, and an action that cannot be afforded is disabled." The failure
// modes that rule excludes are a partial purchase and a debt, so the probe is
// posed one Credit short of the price and both the thing bought and the balance
// are read back afterwards. One Credit short rather than none, because a build
// that refuses only at exactly zero would pass a probe posed at zero.
//
// ONE SINK PER CHECK. Each sink refuses on its own code path, so a build that
// refuses an unaffordable upgrade and still sells fuel it cannot pay for has to
// grade differently from one that gets both wrong.

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
  assertEqual(
    after.miner.fuel,
    FUEL_BEFORE,
    "specs/expedition.md: no fuel is delivered on a balance that cannot cover the increment",
  );
  assertEqual(
    after.credits,
    balance,
    "specs/expedition.md: and nothing is taken from the balance",
  );
});
