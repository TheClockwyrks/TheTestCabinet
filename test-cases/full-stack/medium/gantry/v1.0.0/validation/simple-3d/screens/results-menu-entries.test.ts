// results — the results screen offers `RESULTS_ITEMS` in order.
//
// `specs/ui.md` § Results: the screen shows "the menu `RESULTS_ITEMS`
// (`NEXT SITE`, `REPLAY`, `SITE SELECT`), with `menuIndex` `0` on arriving". The
// three entries and their order are this check; where each leads, and the
// highlight on arriving, are their own points.
//
// THE SITE IS SITE `0`, deliberately not the last one: "On the last site
// `NEXT SITE` is left out and the menu is the other two entries in the same
// order", so a check about the three-entry menu has to be on a site that has a
// next one.
//
// THE SCREEN IS REACHED BY CLEARING THE SITE rather than by posing it, because
// `specs/instrumentation.md` has `setScreen` show a screen and set nothing else
// while "a cleared run records its score on the way to `results`".
//
// THE CLEAR IS EARNED, AND THE ROUTE TO IT IS POSED. The yard is empty, so the
// run clears the moment its tape runs out; the one step is a grip turn, and the
// grip is posed a tenth of a degree short of where that step sends it, so the
// step is driven to its target by the build's own controller over a handful of
// ticks rather than the seventy a full thirty-degree turn takes. `setAxis`
// "takes any value the axis can hold" and leaves the axis stopped with no live
// command (specs/instrumentation.md), and nothing has ticked when it is called,
// so the tick that takes the step issues exactly the command it would have.
// Nothing about the verdict is posed: the tape running out, the clear and the
// move to `results` are all the run's own.
//
// ORDER IS READ OFF THE FRAME'S OWN LAYOUT: every run of text the frame drew,
// taken top to bottom and left to right, has to carry the three entries in the
// order `RESULTS_ITEMS` lists them. That is one reading whether a build stacks
// the menu down the screen or lays it across, and it never depends on the entries
// being three separate runs of text.

import { afterEach, beforeEach, it } from "vitest";

import { drawnTextRuns } from "../case-harness/index";
import { assertEqual, fail } from "../assert";
import { GRIP_MAX_RATE, RESULTS_ITEMS } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** Where the one step sends the grip, and how far short of it it starts. */
const GRIP_TARGET = 30;
const NEAR = 0.1;

/** One short move: enough for a tape to run out and clear an empty yard. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: GRIP_TARGET, rate: GRIP_MAX_RATE }],
  },
];

/**
 * Ticks the run is given to reach its verdict.
 *
 * The move covers a tenth of a degree at `GRIP_ACCEL`, which is four ticks, and
 * the tick after the last step completes is the one that clears; twenty is a
 * fivefold margin over that, and one batched drive rather than twenty crossings
 * into the page.
 */
const END_TICKS = 20;

/** Runs of text this far apart in `y` are on one line of the screen. */
const LINE_SLOP = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * The frame's drawn text, top to bottom and left to right, as one string.
 *
 * The runs are the LOGICAL ones the frame spells, each placed where its first
 * draw was, never the `fillText` split: a build that letter-spaces a label or
 * a figure draws a glyph per call, which is the only portable way to
 * letter-space canvas text, and a line assembled from those glyphs reads `1 2`
 * where the screen says `12`. `screenCalls` carries the measured geometry the
 * shared merge rule (`case-harness/text.ts`) needs to put side-by-side glyphs
 * on one baseline back together, and every raw string is a substring of its
 * run, so coalescing can only add a match.
 */
async function readingOrder(harness: Harness): Promise<string> {
  return drawnTextRuns(await harness.screenCalls())
    .map((draw) => ({ ...draw, line: Math.round(draw.y / LINE_SLOP) }))
    .sort((one, two) => one.line - two.line || one.x - two.x)
    .map((draw) => draw.text)
    .join(" | ")
    .replace(/\s+/g, " ")
    .toUpperCase();
}

it("draws NEXT SITE, REPLAY and SITE SELECT in that order", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);
  await h.debug.setAxis("grip", GRIP_TARGET - NEAR);

  const ended = await runTicks(h, END_TICKS);
  assertEqual(
    ended.run.phase,
    "cleared",
    `the run's phase after ${END_TICKS} ticks: the tape runs out and the ` +
      "emptied yard leaves every load placed (specs/program.md)",
  );
  assertEqual(
    ended.screen,
    "results",
    "the screen a cleared run moves to (specs/ui.md)",
  );

  await h.advance(1);
  const reading = await readingOrder(h);
  let at = 0;
  await h.capture("results-menu", "The results menu");

  for (const entry of RESULTS_ITEMS) {
    const found = reading.indexOf(entry, at);
    if (found < 0) {
      fail(
        `the results menu to draw "${entry}", the RESULTS_ITEMS entry after ` +
          `the ${at === 0 ? "start of the screen" : "one before it"} ` +
          "(specs/ui.md)",
        `the screen reads "${reading}"`,
      );
    }
    at = found + entry.length;
  }
});
