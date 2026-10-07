// sites/site-6-load-count — Site 6 puts exactly two loads in the yard.
//
// specs/sites.md § Site 6 — Heavy Haul gives the site two load rows and says of
// the site in prose: "No obstacles. The heaviest load in the game and a light
// crate far down the yard, from one crane." § The site table says `SITES`
// carries each site's loads "exactly as this file states them".
//
// THE COUNT IS THE REQUIREMENT, and it is a requirement of its own rather than a
// detail of the rows: specs/program.md ends a spent tape "cleared if every load
// is `placed`", so a third load nobody was told about makes a correct tape fail
// the site, and a missing load clears it for free — and on Heavy Haul, the last
// site in the game, the pair is the whole of what the one crane is asked to do.
// What each row SAYS — class, mass, from, to — is `sites/site-6-load-1` and
// `sites/site-6-load-2`.
//
// THE READING IS THE SITE AS IT OPENS: `openSite` and one snapshot, with the
// yard untouched. Emptying it here would erase the very list the point counts.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import { createHarness, openSite, type Harness } from "../harness";

const SITE = 5;

/** specs/sites.md § Site 6 — Heavy Haul carries two load rows and no other. */
const LOAD_COUNT = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stands exactly two loads in Site 6's yard", async () => {
  await openSite(h, SITE);
  await h.advance(1);
  await h.capture("loads", "The loads standing in Site 6's yard");

  const { site } = await h.snapshot();
  assertLength(
    site.loads,
    LOAD_COUNT,
    "the loads Site 6 carries (specs/sites.md § Site 6 — Heavy Haul)",
  );
});
