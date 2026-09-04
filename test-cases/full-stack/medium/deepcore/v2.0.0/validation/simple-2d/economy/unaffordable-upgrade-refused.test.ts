// economy/unaffordable-upgrade-refused — an upgrade the balance cannot cover buys
// nothing.
//
// `specs/expedition.md` states it as a rule over every sink: "Credits never go
// negative, and an action that cannot be afforded is disabled." The failure modes
// that rule excludes are a partial purchase and a debt, so the shop is posed one
// Credit short of the price and both the tier and the balance are read back
// afterwards. One Credit short rather than none, because a build that refuses only
// at exactly zero would pass a probe posed at zero.
//
// `cargo` stands for the six long tracks: it is the one whose tier moves no figure
// this check reads.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { openCamp } from "./camp";
import { upgradePrice } from "./prices";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses an upgrade one Credit short of its price", async () => {
  openCamp(h);
  const balance = (upgradePrice("cargo", 2) ?? 0) - 1;
  h.debug.setCredits(balance);
  h.debug.setPanel("upgrade-shop");

  h.debug.buyUpgrade("cargo");
  await h.advance(1);
  captureStill(h, "refused");

  const after = h.snapshot();
  assertEqual(after.tiers.cargo, 1, "specs/expedition.md");
  assertEqual(after.credits, balance, "specs/expedition.md");
});
