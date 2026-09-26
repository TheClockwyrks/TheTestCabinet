// screens/results-shows-the-par-time — the results screen shows the site's
// par time.
//
// specs/ui.md § Results: "`results` shows `CLEARED_TEXT` (`SITE CLEARED`), the
// run's cost and time beside the site's par cost and par time
// (`specs/sites.md`)". That sentence names four figures, and each is a check of
// its own: a screen that draws the par cost and forgets the par time has to
// grade above one that draws neither. This check decides the par time, the par
// cost is `screens/results-shows-the-par-cost`, and the run's own two figures
// are two checks beside them.
//
// specs/sites.md fixes the number and says what it is for: "Par figures are
// targets to beat, shown beside a clear's score; they gate nothing." Site 1's
// par time is `18`, and this check reads the screen for it.
//
// THE SITE IS CLEARED THE CHEAPEST WAY THERE IS, because par belongs to the
// site rather than to the run: the yard is emptied, so "cleared if every load
// is `placed`" (specs/program.md § The tick pipeline) holds with no load to
// lift, and the minimal crane runs a tape of one hoist move a twentieth of a
// unit long — the shortest move that still ramps up, brakes, runs out and ends
// the run. That leaves the run's own figures — a cost of about `981` and a
// clock of a fifth of a second — nowhere near either par figure, so a screen
// showing only the run's numbers cannot pass this check by accident.
//
// HOW A FIGURE IS READ. The words around a number and the way it is grouped are
// the build's ("`2 400`", "`2,400`", "`PAR 2400`"), so the screen's text is
// read for the NUMBERS in it, with a separator between two digits taken out
// first. `./figures` is this directory's one reading of a number, and it is
// what settles the awkward separator: the space in "`2 400`" groups the figure
// when the build wrote it into a single `fillText`, and does not when a run
// only carries it because the harness's merge put it between two draws.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { HOIST_MAX_RATE, HOIST_START, SITES } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runUntil,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";
import { drawnTextLines } from "../case-harness/index";
import { drawnFigures, valuesOf } from "./figures";

/** Site 1, whose par specs/sites.md gives as cost 2400 and time 18. */
const SITE = 0;
const PAR = SITES[SITE]!.par;

/**
 * A rounding's worth.
 *
 * Both par figures are whole numbers a site authored, so any faithful rendering
 * of one reads back as that number; the half-unit is for a build that draws a
 * figure it holds as a float.
 */
const TOLERANCE = 0.5;

/** One short move: enough for a run to have something to do and to end. */
const A_SHORT_HOIST: TapeStepSpec = {
  kind: "move",
  commands: [
    { axis: "hoist", target: HOIST_START + 0.05, rate: HOIST_MAX_RATE },
  ],
};

/**
 * What the last frame drew on the screen layer: the words it spells, and the
 * figures those words show.
 *
 * specs/overview.md fixes where a readout lives — "over it the screen-space
 * readouts are drawn on a 2D layer composited on top of the picture, laid out
 * in logical stage units" — so the words a screen shows are the runs of text
 * that layer's frame issued, whatever font, colour, or arrangement a build
 * chose for them.
 *
 * Read off the LOGICAL RUNS the frame spells, never off the `fillText` split:
 * a build that letter-spaces its copy draws a glyph per call, which is the only
 * portable way to letter-space canvas text, and the specification fixes the
 * words a screen shows while leaving their spacing to the build. `screenCalls`
 * carries the measured geometry the shared merge rule (`case-harness/text.ts`)
 * needs to put side-by-side glyphs on one baseline back together, and every
 * raw string is a substring of its run, so coalescing can only add a match.
 *
 * The FIGURES come off the same operations through `./figures`, which is this
 * directory's one reading of a number and reads the merged runs and the raw
 * draws they were coalesced from together. The two answers are taken in one
 * crossing so they are answers about the same frame.
 */
interface ScreenReading {
  /** Every logical run the frame spelled, in reading order. */
  readonly lines: string[];
  /** Every figure those runs show, under `./figures`' rule. */
  readonly figures: number[];
}

async function screenReading(harness: Harness): Promise<ScreenReading> {
  const calls = await harness.screenCalls();
  return {
    lines: drawnTextLines(calls),
    figures: valuesOf(drawnFigures(calls)),
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows the site's par time", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, [A_SHORT_HOIST]);

  await startRun(h);
  const ended = await runUntil(
    h,
    (s) => s.run.phase !== "running",
    60,
    "the run to end",
  );
  // The frame that follows the tick that ended it, so what the screen shows is
  // the screen a cleared run left standing.
  await h.advance(1);
  await h.capture("results-par-time", "the site's par time beside the run's");

  assertEqual(ended.run.phase, "cleared", "the run this check reads after");
  assertEqual(
    (await h.snapshot()).screen,
    "results",
    "the screen a cleared run moves to (specs/ui.md § Run)",
  );

  const { lines, figures } = await screenReading(h);
  assertTrue(
    figures.some((one) => Math.abs(one - PAR.time) <= TOLERANCE),
    `the site's par time, ${PAR.time}, among the figures the results screen ` +
      `draws (specs/ui.md § Results, specs/sites.md); it drew ` +
      `[${lines.join(" | ")}]`,
  );
});
