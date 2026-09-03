// sites/site-1-budget — Site 1 holds the crane to the budget it was authored
// with.
//
// specs/sites.md § Site 1 — First Lift gives the site's row `Budget | 3000`, and
// § The site table says `SITES` carries each site's budget "exactly as this file
// states them". That figure is what specs/structure.md measures a crane's cost
// against, so a site reporting a different one grades every build's crane against
// the wrong ceiling.
//
// THE READING IS THE SITE AS IT OPENS. A budget is authored data rather than a
// run outcome: the scenario is `openSite` and one snapshot, with nothing built,
// nothing spent and nothing ticked. What the crane costs against this budget, and
// what the editor refuses past it, are other points; this one decides the figure.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { createHarness, openSite, type Harness } from "../harness";

const SITE = 0;

/** specs/sites.md § Site 1 — First Lift, the `Budget` row. */
const BUDGET = 3000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports Site 1's authored budget of 3000", async () => {
  await openSite(h, SITE);
  await h.capture("budget", "Site 1's budget on the build readout");

  const { site } = await h.snapshot();
  assertEqual(
    site.budget,
    BUDGET,
    "the budget Site 1 carries (specs/sites.md § Site 1 — First Lift)",
  );
});
