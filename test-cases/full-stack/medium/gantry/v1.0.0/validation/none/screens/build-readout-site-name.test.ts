// screens/build-readout-site-name — the build screen's readouts name the open
// site.
//
// specs/ui.md § Build: "Its readouts show the site's name, the cost against the
// budget, the tool palette with each tool's binding and the selected tool marked,
// and the tape's step count." specs/sites.md fixes the six names: "`SITE_NAMES`
// carries the six names in order: `First Lift`, `Turnabout`, `Over the Wall`,
// `Long Reach`, `High Shelf`, `Heavy Haul`."
//
// The site is opened straight through the surface, so a build with a broken site
// select still fails or passes this on its readout alone. Site index 3 is used
// rather than the first, because a build that draws a fixed name would pass on
// site `0` by accident.
//
// WHAT IS READ IS THE FRAME'S OWN TEXT rather than `snapshot().site.name`: the
// snapshot says what the game holds, and a readout that never draws it is exactly
// the miss this point is about. specs/overview.md § Units, ticks, and the stage
// fixes where to look — "over it the screen-space readouts are drawn on a 2D
// layer composited on top of the picture" — so the reading is the text the last
// frame drew on that layer, which `h.screenCalls()` answers with every text call
// measured.
//
// MATCHING IGNORES CASE AND SPACING. How a build sets its readouts is its own —
// `LONG REACH`, `Long Reach`, `4 · Long Reach` — so the name is read with the
// shared harness's `drewTextAnywhere`: the frame's logical runs joined in
// reading order with the whitespace folded out, matched as a substring ignoring
// case, so a name letter-spaced a glyph per call or set beside its number still
// reads as the name.

import { afterEach, beforeEach, it } from "vitest";
import { drawnTextLines, drewTextAnywhere } from "../case-harness/index";
import { fail } from "../assert";
import { SITE_NAMES } from "../constants";
import { createHarness, openSite, type Harness } from "../harness";

/** The site this check opens: `Long Reach` (specs/sites.md § Site 4). */
const SITE = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the open site's name on the build screen", async () => {
  await openSite(h, SITE);
  await h.advance(1);

  const calls = await h.screenCalls();
  await h.capture("build-name", "The site name readout");

  if (!drewTextAnywhere(calls, SITE_NAMES[SITE])) {
    fail(
      `the build screen to draw the open site's name, "${SITE_NAMES[SITE]}" ` +
        "(specs/ui.md § Build, specs/sites.md)",
      `it drew ${JSON.stringify(drawnTextLines(calls))}`,
    );
  }
});
