// sites/site-5-load-count — Site 5 puts exactly two loads in the yard.
//
// specs/sites.md § Site 5 — High Shelf gives the site two load rows and says of
// the site in prose: "A container set down on top of the platform, turned a
// quarter as its target pose asks, and a crate placed on the ground beside it."
// § The site table says `SITES` carries each site's loads "exactly as this file
// states them".
//
// THE COUNT IS THE REQUIREMENT, and it is a requirement of its own rather than a
// detail of the rows: specs/program.md ends a spent tape "cleared if every load
// is `placed`", so a third load nobody was told about makes a correct tape fail
// the site, and a missing load clears it for free — and on High Shelf, whose
// whole shape is the pair of deliveries its prose names, one load is a different
// site. What each row SAYS — class, mass, from, to — is `sites/site-5-load-1`
// and `sites/site-5-load-2`.
//
// THE READING IS THE SITE AS IT OPENS: `openSite` and one snapshot, with the
// yard untouched. Emptying it here would erase the very list the point counts.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import { createHarness, openSite, type Harness } from "../harness";

const SITE = 4;

/** specs/sites.md § Site 5 — High Shelf carries two load rows and no other. */
const LOAD_COUNT = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stands exactly two loads in Site 5's yard", async () => {
  await openSite(h, SITE);
  await h.advance(1);
  await h.capture("loads", "The loads standing in Site 5's yard");

  const { site } = await h.snapshot();
  assertLength(
    site.loads,
    LOAD_COUNT,
    "the loads Site 5 carries (specs/sites.md § Site 5 — High Shelf)",
  );
});
