// sites/site-1-load-count — Site 1 puts exactly one load in the yard.
//
// specs/sites.md § Site 1 — First Lift gives the site one load row and says of
// the site in prose: "No obstacles. One crate, a quarter turn around the yard."
// § The site table says `SITES` carries each site's loads "exactly as this file
// states them".
//
// THE COUNT IS THE REQUIREMENT, and it is a requirement of its own rather than a
// detail of the row: specs/program.md ends a spent tape "cleared if every load is
// `placed`", so a second load nobody was told about makes a correct tape fail the
// site, and a missing load clears it for free. What that one row SAYS — class,
// mass, from, to — is `sites/site-1-load-1`.
//
// THE READING IS THE SITE AS IT OPENS: `openSite` and one snapshot, with the yard
// untouched. Emptying it here would erase the very list the point counts.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import { createHarness, openSite, type Harness } from "../harness";

const SITE = 0;

/** specs/sites.md § Site 1 — First Lift carries one load row and no other. */
const LOAD_COUNT = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stands exactly one load in Site 1's yard", async () => {
  await openSite(h, SITE);
  await h.capture("loads", "The load standing in Site 1's yard");

  const { site } = await h.snapshot();
  assertLength(
    site.loads,
    LOAD_COUNT,
    "the loads Site 1 carries (specs/sites.md § Site 1 — First Lift)",
  );
});
