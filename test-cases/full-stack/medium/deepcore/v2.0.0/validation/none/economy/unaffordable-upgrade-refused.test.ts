// economy/unaffordable-upgrade-refused — an upgrade the balance cannot cover buys nothing.
//
// `specs/expedition.md` states it as a rule over every sink: "Credits never go
// negative, and an action that cannot be afforded is disabled." The failure modes
// that rule excludes are a partial purchase and a debt, so the probe is posed one
// Credit short of the price and both the thing bought and the balance are read
// back afterwards. One Credit short rather than none, because a build that
// refuses only at exactly zero would pass a probe posed at zero.
//
// ONE SINK PER SCRIPT. The three sinks a camp offers are three requirements: a
// build that refuses an unaffordable upgrade and sells fuel it cannot pay for has
// missed one of them and must grade differently from one that misses all three.
// The rocket's own refusal is `rocket/fabrication-refused-without-credits`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { UPGRADE_PRICES } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { openCamp } from "./camp";

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
  assertEqual(after.tiers.cargo, 1, "specs/expedition.md");
  assertEqual(after.credits, balance, "specs/expedition.md");
});
