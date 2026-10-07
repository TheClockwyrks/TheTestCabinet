// screens/build-readout-cost-against-budget — the build screen's readouts show
// what the crane costs and the budget it is measured against.
//
// specs/ui.md § Build: "Its readouts show the site's name, the cost against the
// budget, the tool palette with each tool's binding and the selected tool marked,
// and the tape's step count." specs/structure.md fixes both figures: a structure
// costs "`RING_COST` per ring" plus each member's length times its material's
// cost per unit, and "Each site fixes a budget"; specs/sites.md fixes site 4's
// budget at `5600`.
//
// THE CRANE IS POSED TO A COST WITH NO ROUNDING IN IT: a ring (`RING_COST`, 300)
// and two struts two units long (`STRUT_COST_PER_UNIT` 10, so 20 each), which is
// 340 exactly. A readout is free to round what it shows, and a crane costing
// 981.43 would leave "981", "981.4" and "982" all conformant; 340 leaves one
// number to look for whatever the build rounds to. The cost the readout is held
// to is the one the game itself reports, so a build whose cost model is wrong
// fails that in specs/structure.md's own points rather than twice here.
//
// The two figures are looked for among the frame's runs rather than inside one
// run: "the cost against the budget" fixes that both are shown and leaves
// "340 / 5600", "340 of 5600" and a cost over a budget on two lines all open to a
// build. How a figure itself is set is the build's too — "5600", "5,600" and
// "5 600" are one budget — and `./figures` is this directory's one reading of
// that.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue, fail } from "../assert";
import { RING_COST, SITES, STRUT_COST_PER_UNIT } from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";
import { drawnFigures, valuesOf } from "./figures";

/** The site this check opens: `Long Reach`, budget `5600` (specs/sites.md). */
const SITE = 3;

/** The ring and two two-unit struts: `300 + 20 + 20` (specs/structure.md). */
const COST = RING_COST + 2 * (2 * STRUT_COST_PER_UNIT);

/** How far the drawn cost may sit from the cost the game reports. */
const ROUNDING = 1;

/**
 * Every figure the last closed frame drew on the screen layer.
 *
 * Read off the LOGICAL RUNS the frame spells and off the raw draws they were
 * coalesced from, never off the `fillText` split alone: a build that
 * letter-spaces its copy draws a glyph per call, which is the only portable way
 * to letter-space canvas text, and the specification fixes what a readout shows
 * while leaving its setting to the build. `screenCalls` carries the measured
 * geometry the shared merge rule (`case-harness/text.ts`) needs to put
 * side-by-side glyphs on one baseline back together, and `./figures` reads the
 * runs that merge spells together with the draws it spelled them from — so
 * `5 600` grouped inside one call reads as the budget, while a space the merge
 * itself wrote between two draws still separates two figures.
 */
async function frameFigures(harness: Harness): Promise<number[]> {
  return valuesOf(drawnFigures(await harness.screenCalls()));
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the crane's cost and the site's budget on the build screen", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.debug.setRing(0, 2, 0);
  await h.debug.addMember(0, 0, 0, 0, 2, 0, "strut");
  await h.debug.addMember(2, 0, 0, 2, 2, 0, "strut");

  const { structure } = await h.snapshot();
  await h.advance(1);
  const drawn = await frameFigures(h);
  await h.capture("build-cost", "The cost readout");

  assertTrue(
    Math.abs(structure.cost - COST) < 1e-6,
    `the posed crane to cost ${COST}, the ring and two two-unit struts this ` +
      "check reads the readout against (specs/structure.md)",
  );

  if (!drawn.some((value) => Math.abs(value - structure.cost) <= ROUNDING)) {
    fail(
      `the build screen to draw the crane's cost, ${structure.cost} ` +
        "(specs/ui.md § Build)",
      `it drew the numbers ${JSON.stringify(drawn)}`,
    );
  }
  const budget = SITES[SITE]!.budget;
  if (!drawn.includes(budget)) {
    fail(
      `the build screen to draw the budget the cost is measured against, ` +
        `${budget} (specs/ui.md § Build, specs/sites.md)`,
      `it drew the numbers ${JSON.stringify(drawn)}`,
    );
  }
});
