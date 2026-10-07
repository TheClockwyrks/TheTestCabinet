// economy/unaffordable-supply-refused — a field supply beyond the balance buys
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
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { openCamp } from "./camp";
import { ITEM_PRICE } from "./prices";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a field supply one Credit short of its price", async () => {
  openCamp(h);
  const balance = ITEM_PRICE.dynamite - 1;
  h.debug.setCredits(balance);
  h.debug.setPanel("supply-depot");

  h.debug.buyItem("dynamite");
  await h.advance(1);
  captureStill(h, "refused");

  const after = h.snapshot();
  assertEqual(
    after.items.dynamite,
    0,
    "specs/items.md: nothing is held on a balance that cannot cover it",
  );
  assertEqual(
    after.credits,
    balance,
    "specs/expedition.md: and nothing is taken from the balance",
  );
});
