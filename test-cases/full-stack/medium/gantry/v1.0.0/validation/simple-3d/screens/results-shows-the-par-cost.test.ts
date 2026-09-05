// screens/results-shows-the-par-cost — the results screen shows the site's
// par cost.
//
// specs/ui.md § Results: "`results` shows `CLEARED_TEXT` (`SITE CLEARED`), the
// run's cost and time beside the site's par cost and par time
// (`specs/sites.md`)". That sentence names four figures, and each is a check of
// its own: a screen that draws the par cost and forgets the par time has to
// grade above one that draws neither. This check decides the par cost, the par
// time is `screens/results-shows-the-par-time`, and the run's own two figures
// are two checks beside them.
//
// specs/sites.md fixes the number and says what it is for: "Par figures are
// targets to beat, shown beside a clear's score; they gate nothing." Site 1's
// par cost is `2400`, and this check reads the screen for it.
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
// first.

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
import { drawnText, toDrawCall } from "../case-harness/index";

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
 * Every run of text the last frame drew on the screen layer.
 *
 * specs/overview.md fixes where a readout lives — "over it the screen-space
 * readouts are drawn on a 2D layer composited on top of the picture, laid out
 * in logical stage units" — so the words a screen shows are the runs of text
 * that layer's frame issued, whatever font, colour, or arrangement a build
 * chose for them. */
async function screenText(harness: Harness): Promise<string[]> {
  const ops = await harness.screenOps();
  return drawnText(ops.map(toDrawCall));
}

/**
 * The separators a build may set between a figure's digit triples.
 *
 * ASCII space is deliberately absent: a frame's text is assembled by joining
 * separate draw runs with one, so accepting it would read the two figures in
 * `40 130` as the single number 40130. `.` is absent for the same sort of
 * reason — it is the decimal point, and a build drawing `1.5` means one and a
 * half.
 */
const GROUP = "[,'\\u00A0\\u202F\\u2009]";

/** One drawn number: a grouped figure, or a plain one. */
const DRAWN = new RegExp(
  `\\d{1,3}(?:${GROUP}\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?`,
  "g",
);

/**
 * Every number the drawn text carries, as figures rather than characters.
 *
 * A grouped figure reads as the one figure it is, so `1,234` and `1234` both
 * come back as 1234 and a build is free to group the figure it draws.
 */
function drawnNumbers(runs: readonly string[]): number[] {
  return runs.flatMap((run) =>
    (run.match(DRAWN) ?? []).map((one) =>
      Number(one.replace(new RegExp(GROUP, "g"), "")),
    ),
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows the site's par cost", async () => {
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
  await h.capture("results-par-cost", "the site's par cost beside the run's");

  assertEqual(ended.run.phase, "cleared", "the run this check reads after");
  assertEqual(
    (await h.snapshot()).screen,
    "results",
    "the screen a cleared run moves to (specs/ui.md § Run)",
  );

  const shown = await screenText(h);
  const figures = drawnNumbers(shown);
  assertTrue(
    figures.some((one) => Math.abs(one - PAR.cost) <= TOLERANCE),
    `the site's par cost, ${PAR.cost}, among the figures the results screen ` +
      `draws (specs/ui.md § Results, specs/sites.md); it drew ` +
      `[${shown.join(" | ")}]`,
  );
});
