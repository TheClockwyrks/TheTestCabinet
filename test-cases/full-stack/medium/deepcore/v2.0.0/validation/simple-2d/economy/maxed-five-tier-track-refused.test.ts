// economy/maxed-five-tier-track-refused — tier 5 is the end of a five-tier track.
//
// `specs/upgrades.md` gives six tracks five tiers and says the shop disables a
// track that is maxed out. So a purchase attempted on a track already at its
// highest tier changes nothing: the tier does not rise past the table and no
// Credits are taken. The balance is posed far above every price on the ladder, so
// a refusal here can only be the ceiling rather than the cost.
//
// THE SCANNER IS ITS OWN CHECK. Its ceiling is a different figure on a different
// ladder — `economy/maxed-scanner-refused` — so a build that stops the six long
// tracks and lets the scanner run on grades differently from one that stops
// neither.

import { afterEach, beforeEach, it } from "vitest";
import { MAX_TIER } from "../constants";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { openCamp } from "./camp";

/** More than any rung of the ladder, so nothing is refused for want of it. */
const CREDITS_BEFORE = 100000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a further purchase on a five-tier track at tier 5", async () => {
  openCamp(h);
  h.debug.setTier("cargo", MAX_TIER.cargo);
  h.debug.setCredits(CREDITS_BEFORE);
  h.debug.setPanel("upgrade-shop");

  h.debug.buyUpgrade("cargo");
  await h.advance(1);
  captureStill(h, "maxed");

  const after = h.snapshot();
  assertEqual(
    after.tiers.cargo,
    MAX_TIER.cargo,
    "specs/upgrades.md: the tier does not rise past the table's highest",
  );
  assertEqual(
    after.credits,
    CREDITS_BEFORE,
    "specs/upgrades.md: and nothing is taken for it",
  );
});
