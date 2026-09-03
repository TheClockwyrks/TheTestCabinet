// sites/site-3-load-count — Site 3 puts exactly one load in the yard.
//
// specs/sites.md § Site 3 — Over the Wall gives the site one load row and says of
// the site in prose: "One crate whose path crosses the wall: the lift goes up,
// over, and down." § The site table says `SITES` carries each site's loads
// "exactly as this file states them".
//
// THE COUNT IS THE REQUIREMENT, and it is a requirement of its own rather than a
// detail of the row: specs/program.md ends a spent tape "cleared if every load is
// `placed`", so a second load nobody was told about makes a correct tape fail the
// site, and a missing load clears it for free — and here a second load would have
// to be flown over the same wall to boot. What that one row SAYS — class, mass,
// from, to — is `sites/site-3-load-1`.
//
// THE READING IS THE SITE AS IT OPENS: `openSite` and one snapshot, with the yard
// untouched. Emptying it here would erase the very list the point counts.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import { createHarness, openSite, type Harness } from "../harness";

const SITE = 2;

/** specs/sites.md § Site 3 — Over the Wall carries one load row and no other. */
const LOAD_COUNT = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stands exactly one load in Site 3's yard", async () => {
  await openSite(h, SITE);
  await h.capture("loads", "The load standing in Site 3's yard");

  const { site } = await h.snapshot();
  assertLength(
    site.loads,
    LOAD_COUNT,
    "the loads Site 3 carries (specs/sites.md § Site 3 — Over the Wall)",
  );
});
