// sites/site-2-no-obstacles — Site 2's yard is clear.
//
// specs/sites.md § Site 2 — Turnabout carries no obstacle table and says so in
// prose: "No obstacles. Two crates, each straight across the yard." § The site
// table says `SITES` carries each site's obstacles "exactly as this file states
// them", and for this site that is none.
//
// AN ABSENCE IS A REQUIREMENT HERE, because an obstacle is not scenery: an
// obstacle the site was not authored with fails a run of its own accord —
// specs/statics.md's `structure-struck-obstacle` and `load-struck-obstacle` — and
// specs/structure.md refuses an edit that passes through one. Turnabout's two
// crates cross the yard on opposite axes, so a stray box anywhere in it stands in
// one of the two paths.
//
// THE READING IS THE SITE AS IT OPENS: `openSite` and one snapshot, the yard
// untouched. `emptyYard` is exactly the wrong move here — it would clear the very
// list this point reads and pass any build.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import { createHarness, openSite, type Harness } from "../harness";

const SITE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stands no obstacle in Site 2's yard", async () => {
  await openSite(h, SITE);
  await h.capture("state", "Site 2's yard, with nothing in the way");

  const { site } = await h.snapshot();
  assertLength(
    site.obstacles,
    0,
    "the obstacles Site 2 carries (specs/sites.md § Site 2 — Turnabout)",
  );
});
