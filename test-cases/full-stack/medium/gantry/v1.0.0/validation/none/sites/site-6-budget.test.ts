// sites/site-6-budget — Site 6 holds the crane to the budget it was authored
// with.
//
// specs/sites.md § Site 6 — Heavy Haul gives the site's row `Budget | 6000`,
// and § The site table says `SITES` carries each site's budget "exactly as this
// file states them". That figure is what specs/structure.md measures a crane's
// cost against — "each site fixes a budget, and the cost never exceeds it: an
// edit that would take the cost past the budget is refused" — so a site
// reporting a different one grades every build's crane against the wrong
// ceiling: too low and a conforming design is refused mid-build, too high and
// the site stops being the puzzle it was authored as. Heavy Haul carries the
// largest budget in the game, which is what pays for the crane its prose asks
// for: "the heaviest load in the game and a light crate far down the yard, from
// one crane".
//
// THE READING IS THE SITE AS IT OPENS. A budget is authored data rather than a
// run outcome: the scenario is `openSite` and one snapshot, with nothing built,
// nothing spent and nothing ticked. What the crane costs against this budget,
// and what the editor refuses past it, are other points; this one decides the
// figure.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { createHarness, openSite, type Harness } from "../harness";

const SITE = 5;

/** specs/sites.md § Site 6 — Heavy Haul, the `Budget` row. */
const BUDGET = 6000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports Site 6's authored budget of 6000", async () => {
  await openSite(h, SITE);
  await h.advance(1);
  await h.capture("budget", "Site 6's budget on the build readout");

  const { site } = await h.snapshot();
  assertEqual(
    site.budget,
    BUDGET,
    "the budget Site 6 carries (specs/sites.md § Site 6 — Heavy Haul)",
  );
});
