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
// frame drew on that layer, which the harness's injected recorder holds.
//
// MATCHING IGNORES CASE, SPACING AND PUNCTUATION. How a build sets its readouts
// is its own — `LONG REACH`, `Long Reach`, `4 · Long Reach` — so the frame's runs
// are joined in draw order and compared with everything but letters and digits
// removed.

import { afterEach, beforeEach, it } from "vitest";
import { drawnText, toDrawCall, type RecordedOp } from "../case-harness/index";
import { fail } from "../assert";
import { SITE_NAMES } from "../constants";
import { createHarness, openSite, type Harness } from "../harness";

/** The page global the shared harness installs its draw recorder on. */
const RECORDER = "__tcabRec";

/** The site this check opens: `Long Reach` (specs/sites.md § Site 4). */
const SITE = 3;

/** Every run of text the last closed frame drew, in draw order. */
async function frameText(harness: Harness): Promise<string[]> {
  const ops = (await harness.page.evaluate(
    (global) =>
      (window as unknown as Record<string, { last(): unknown[] }>)[
        global
      ]!.last(),
    RECORDER,
  )) as RecordedOp[];
  return drawnText(ops.map(toDrawCall));
}

/** Letters and digits alone, lowercased: the form two runs are compared in. */
function bare(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

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

  const runs = await frameText(h);
  await h.capture("build-name", "The site name readout");

  const wanted = bare(SITE_NAMES[SITE]);
  if (!bare(runs.join(" ")).includes(wanted)) {
    fail(
      `the build screen to draw the open site's name, "${SITE_NAMES[SITE]}" ` +
        "(specs/ui.md § Build, specs/sites.md)",
      `it drew ${JSON.stringify(runs)}`,
    );
  }
});
