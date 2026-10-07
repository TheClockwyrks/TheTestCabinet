// sites/site-1-no-obstacles — Site 1's yard is clear.
//
// specs/sites.md § Site 1 — First Lift carries no obstacle table and says so in
// prose: "No obstacles. One crate, a quarter turn around the yard." § The site
// table says `SITES` carries each site's obstacles "exactly as this file states
// them", and for this site that is none.
//
// AN ABSENCE IS A REQUIREMENT HERE, because an obstacle is not scenery: an
// obstacle the site was not authored with fails a run of its own accord —
// specs/statics.md's `structure-struck-obstacle` and `load-struck-obstacle` — and
// specs/structure.md refuses an edit that passes through one. So a stray box on
// the game's first site can make a correct crane unbuildable and a correct tape
// unclearable, on the site a player meets first.
//
// THE READING IS THE SITE AS IT OPENS: `openSite` and one snapshot, the yard
// untouched. `emptyYard` is exactly the wrong move here — it would clear the very
// list this point reads and pass any build.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import { createHarness, openSite, type Harness } from "../harness";

const SITE = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stands no obstacle in Site 1's yard", async () => {
  await openSite(h, SITE);
  await h.capture("state", "Site 1's yard, with nothing in the way");

  const { site } = await h.snapshot();
  assertLength(
    site.obstacles,
    0,
    "the obstacles Site 1 carries (specs/sites.md § Site 1 — First Lift)",
  );
});
