// sites/site-3-par — Site 3's par figures are the ones the specification
// wrote.
//
// specs/sites.md § Site 3 — Over the Wall gives the site's row
// `Par | cost 3550, time 40`, and § The site table says `SITES` carries each
// site's "par cost and par time" exactly as this file states them. The file's
// preamble says what they are for: "Par figures are targets to beat, shown
// beside
// a clear's score; they gate nothing."
//
// BOTH FIGURES ARE ONE POINT, because they are one row: par is the pair a
// results screen shows a clear's cost and time against, and a build that showed
// one of the two wrong shows a player the wrong target either way. Over the
// Wall's par cost is well above the two sites before it, the price of a crane
// that clears the wall.
//
// THE READING IS THE SITE AS IT OPENS. Par gates nothing, so there is nothing
// to
// drive: the scenario is `openSite` and one snapshot, with no crane built and
// no
// run started. Where the results screen puts these figures beside a score is a
// presentation point of its own; this one decides the figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { createHarness, openSite, type Harness } from "../harness";

const SITE = 2;

/** specs/sites.md § Site 3 — Over the Wall, the `Par` row. */
const PAR_COST = 3550;
const PAR_TIME = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports Site 3's authored par cost and par time", async () => {
  await openSite(h, SITE);
  await h.capture("state", "Site 3's par figures, as the site carries them");

  const { site } = await h.snapshot();
  const where = "(specs/sites.md § Site 3 — Over the Wall)";

  assertEqual(site.par.cost, PAR_COST, `the site's par cost ${where}`);
  assertEqual(site.par.time, PAR_TIME, `the site's par time ${where}`);
});
