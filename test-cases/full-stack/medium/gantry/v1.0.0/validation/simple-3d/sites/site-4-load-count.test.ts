// sites/site-4-load-count — Site 4 puts exactly one load in the yard.
//
// specs/sites.md § Site 4 — Long Reach gives the site one load row and says of
// the site in prose: "No obstacles. A heavy container delivered far from the
// anchors, turned a quarter on the way." § The site table says `SITES` carries
// each site's loads "exactly as this file states them".
//
// THE COUNT IS THE REQUIREMENT, and it is a requirement of its own rather than a
// detail of the row: specs/program.md ends a spent tape "cleared if every load
// is `placed`", so a second load nobody was told about makes a correct tape fail
// the site, and a missing load clears it for free. On Long Reach, whose whole
// shape is one container carried out to the far end of the envelope, a second
// load would be a different site. What the row SAYS — class, mass, from, to —
// is `sites/site-4-load-1`.
//
// THE READING IS THE SITE AS IT OPENS: `openSite` and one snapshot, with the
// yard untouched. Emptying it here would erase the very list the point counts.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import { createHarness, openSite, type Harness } from "../harness";

const SITE = 3;

/** specs/sites.md § Site 4 — Long Reach carries one load row and no other. */
const LOAD_COUNT = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stands exactly one load in Site 4's yard", async () => {
  await openSite(h, SITE);
  await h.advance(1);
  await h.capture("loads", "The load standing in Site 4's yard");

  const { site } = await h.snapshot();
  assertLength(
    site.loads,
    LOAD_COUNT,
    "the loads Site 4 carries (specs/sites.md § Site 4 — Long Reach)",
  );
});
