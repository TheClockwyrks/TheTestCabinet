// sites/site-2-load-count — Site 2 puts exactly two loads in the yard.
//
// specs/sites.md § Site 2 — Turnabout gives the site two load rows and says of
// the site in prose: "No obstacles. Two crates, each straight across the yard."
// § The site table says `SITES` carries each site's loads "exactly as this file
// states them".
//
// THE COUNT IS THE REQUIREMENT, and it is a requirement of its own rather than a
// detail of the rows: specs/program.md ends a spent tape "cleared if every load
// is `placed`", so a third load nobody was told about makes a correct tape fail
// the site, and a missing load clears it for free — and on Turnabout, whose whole
// shape is one crate carried each way, a single load is a different site. What
// each row SAYS — class, mass, from, to — is `sites/site-2-load-1` and
// `sites/site-2-load-2`.
//
// THE READING IS THE SITE AS IT OPENS: `openSite` and one snapshot, with the yard
// untouched. Emptying it here would erase the very list the point counts.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import { createHarness, openSite, type Harness } from "../harness";

const SITE = 1;

/** specs/sites.md § Site 2 — Turnabout carries two load rows and no other. */
const LOAD_COUNT = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stands exactly two loads in Site 2's yard", async () => {
  await openSite(h, SITE);
  await h.capture("loads", "The loads standing in Site 2's yard");

  const { site } = await h.snapshot();
  assertLength(
    site.loads,
    LOAD_COUNT,
    "the loads Site 2 carries (specs/sites.md § Site 2 — Turnabout)",
  );
});
