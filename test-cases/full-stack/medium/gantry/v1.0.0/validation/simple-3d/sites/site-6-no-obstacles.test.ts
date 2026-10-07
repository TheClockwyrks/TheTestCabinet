// sites/site-6-no-obstacles — Site 6's yard is clear.
//
// specs/sites.md § Site 6 — Heavy Haul carries no obstacle table and says so in
// prose: "No obstacles. The heaviest load in the game and a light crate far down
// the yard, from one crane." § The site table says `SITES` carries each site's
// obstacles "exactly as this file states them", and for this site that is none.
//
// AN ABSENCE IS A REQUIREMENT HERE, because an obstacle is not scenery: an
// obstacle the site was not authored with fails a run of its own accord —
// specs/statics.md's `structure-struck-obstacle` and `load-struck-obstacle` — and
// specs/structure.md refuses an edit that passes through one. On the game's last
// site, whose crane has to be big enough for a 120-mass drum and long enough to
// reach `x 14`, a stray box makes a correct crane unbuildable and a correct tape
// unclearable.
//
// THE READING IS THE SITE AS IT OPENS: `openSite` and one snapshot, the yard
// untouched. `emptyYard` is exactly the wrong move here — it would clear the very
// list this point reads and pass any build.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import { createHarness, openSite, type Harness } from "../harness";

const SITE = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stands no obstacle in Site 6's yard", async () => {
  await openSite(h, SITE);
  await h.capture("state", "Site 6's yard, with nothing in the way");

  const { site } = await h.snapshot();
  assertLength(
    site.obstacles,
    0,
    "the obstacles Site 6 carries (specs/sites.md § Site 6 — Heavy Haul)",
  );
});
