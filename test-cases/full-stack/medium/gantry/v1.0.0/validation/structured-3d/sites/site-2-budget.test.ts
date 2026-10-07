// sites/site-2-budget — Site 2 holds the crane to the budget it was authored
// with.
//
// specs/sites.md § Site 2 — Turnabout gives the site's row `Budget | 3600`, and
// § The site table says `SITES` carries each site's budget "exactly as this file
// states them". That figure is what specs/structure.md measures a crane's cost
// against, so a site reporting a different one grades every build's crane against
// the wrong ceiling: too low and a conforming design is refused mid-build, too
// high and the site stops being the puzzle it was authored as.
//
// THE READING IS THE SITE AS IT OPENS. A budget is authored data rather than a
// run outcome: the scenario is `openSite` and one snapshot, with nothing built,
// nothing spent and nothing ticked. What the crane costs against this budget, and
// what the editor refuses past it, are other points; this one decides the figure.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { createHarness, openSite, type Harness } from "../harness";

const SITE = 1;

/** specs/sites.md § Site 2 — Turnabout, the `Budget` row. */
const BUDGET = 3600;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports Site 2's authored budget of 3600", async () => {
  await openSite(h, SITE);
  await h.capture("budget", "Site 2's budget on the build readout");

  const { site } = await h.snapshot();
  assertEqual(
    site.budget,
    BUDGET,
    "the budget Site 2 carries (specs/sites.md § Site 2 — Turnabout)",
  );
});
