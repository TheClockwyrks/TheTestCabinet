// sites/site-4-budget — Site 4 holds the crane to the budget it was authored
// with.
//
// specs/sites.md § Site 4 — Long Reach gives the site's row `Budget | 5600`,
// and § The site table says `SITES` carries each site's budget "exactly as this
// file states them". That figure is what specs/structure.md measures a crane's
// cost against — "each site fixes a budget, and the cost never exceeds it: an
// edit that would take the cost past the budget is refused" — so a site
// reporting a different one grades every build's crane against the wrong
// ceiling: too low and a conforming design is refused mid-build, too high and
// the site stops being the puzzle it was authored as. Long Reach is the most
// expensive site in the game, and its budget is what pays for the reach its
// prose asks for: "a heavy container delivered far from the anchors".
//
// THE READING IS THE SITE AS IT OPENS. A budget is authored data rather than a
// run outcome: the scenario is `openSite` and one snapshot, with nothing built,
// nothing spent and nothing ticked. What the crane costs against this budget,
// and what the editor refuses past it, are other points; this one decides the
// figure.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { createHarness, openSite, type Harness } from "../harness";

const SITE = 3;

/** specs/sites.md § Site 4 — Long Reach, the `Budget` row. */
const BUDGET = 5600;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports Site 4's authored budget of 5600", async () => {
  await openSite(h, SITE);
  // A frame after the pose, so the still is the site this check is about:
  // the harness took the game off its own clock, and a capture keeps "whatever
  // the last frame that RAN left behind".
  await h.advance(1);
  await h.capture("budget", "Site 4's budget on the build readout");

  const { site } = await h.snapshot();
  assertEqual(
    site.budget,
    BUDGET,
    "the budget Site 4 carries (specs/sites.md § Site 4 — Long Reach)",
  );
});
