// screens/results-shows-the-run-cost — the results screen shows the cost of the
// crane the run was made with.
//
// specs/ui.md § Results: "`results` shows `CLEARED_TEXT` (`SITE CLEARED`), the
// run's cost and time beside the site's par cost and par time". That sentence
// names four figures, and each is a check of its own: a screen that draws the
// run's cost and forgets its clock has to grade above one that draws neither.
// This check decides the run's cost, the run's time is
// `screens/results-shows-the-run-time`, and the site's par figures are two
// checks beside them.
//
// The figure is one of the pair specs/program.md § Starting and ending a run
// says a clear records: "A run that ends cleared records the site's score, the
// crane's cost and the run clock at the tick it ended on". So the cost is the
// crane's own (specs/structure.md § Cost and the budget).
//
// THE FIGURE IS READ OFF THE BUILD'S OWN SNAPSHOT rather than written in here:
// what the screen has to show is the cost of the crane the run was made with,
// whatever that came out as, so the check compares the drawn figures against
// `structure.cost`.
//
// THE RUN IS ONE SLEW MOVE, AND ITS CLOCK IS A WHOLE NUMBER OF SECONDS. The
// controller of specs/program.md § Axis motion is exact, so a turn of the arm
// takes a fixed count of ticks, and `30` degrees at
// `SLEW_MAX_RATE` is the turn whose count is exact by construction rather than
// by arithmetic luck. At `SLEW_ACCEL` (`30`) the arm takes one whole second to
// reach `SLEW_MAX_RATE` (`30`) and one whole second to brake back to rest, and
// those two ramps between them cover `30` degrees — so this turn is exactly the
// ramp up and the ramp down with no cruise between, the critical profile, and
// the axis settles ONTO the target rather than crossing it somewhere inside a
// tick. The arm arrives on tick `119`; the step is found complete at the top of
// tick `120` (specs/program.md § The tick pipeline), and that tick, finding no
// step left, is the tick the run ends on. The clock reads two seconds. A target
// either side of the critical one lands the ending a tick or two elsewhere,
// which is why the check turns exactly this far.
//
// That matters because how many decimals a build shows is its own business: at
// a whole number of seconds, `2`, `2.0` and `2.00` are the same figure. And `2`
// is a figure nothing else on this screen carries — the crane costs `981.43`,
// site 1's par is `2400` and `18`, and the standing best below is `500` and
// `3`.
//
// THE RUN IS DRIVEN IN BULK TO THE TICK BEFORE IT ENDS, and swept one tick at a
// time only over the handful of ticks around the ending. The ending is still
// EARNED — the run's own rules decide the clear on the tick they reach it, and
// nothing here poses a phase — and this check simply stops asking after every
// single tick on the way there. Driving the whole run a tick at a time cost
// three hundred crossings into the page to learn what the last two of them say.
//
// A BETTER SCORE IS RECORDED BEFORE THE RUN, so a screen that shows only the
// site's best cannot pass for one that shows the run's. specs/ui.md § Results:
// a later clear replaces the best "when its cost is lower, or equal with a
// lower time", and this crane costs far more than the score posed here, so the
// best stays a different pair of numbers from the run's.
//
// The yard is emptied and the crane is the minimal one, so nothing is lifted
// and the run clears on the tape alone ("cleared if every load is `placed`",
// specs/program.md § The tick pipeline).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { SLEW_MAX_RATE } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  runUntil,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";
import { drawnTextLines } from "../case-harness/index";
import { drawnFigures, valuesOf } from "./figures";

/** Site 1. Which site it is decides nothing here; its yard is emptied. */
const SITE = 0;

/** A score no clear of this site with this crane can replace. */
const STANDING_BEST = { cost: 500, time: 3 };

/** Turn the arm: a move whose run clock lands on a whole second. */
const A_SLEW: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "slew", target: 30, rate: SLEW_MAX_RATE }],
};

/**
 * Ticks driven in one go before the ending is swept for.
 *
 * The turn arrives on tick `119` and the run ends on tick `120`, so this stops
 * short of both and the sweep below covers the ending itself.
 */
const BULK_TICKS = 118;

/** How far past that the run is swept, a tick at a time, for its ending. */
const SWEEP_TICKS = 40;

/**
 * How far a drawn cost may sit from the cost it presents.
 *
 * A crane's cost is a length times a rate per unit and comes out fractional,
 * and how many decimals of it a build shows — or whether it rounds or truncates
 * to whole cost units — is presentation, so a unit either way is honest. */
const COST_TOLERANCE = 1;

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

it("shows the cost of the crane the run was made with", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, [A_SLEW]);
  await h.debug.setBest(SITE, STANDING_BEST.cost, STANDING_BEST.time);

  await startRun(h);
  await runTicks(h, BULK_TICKS);
  const ended = await runUntil(
    h,
    (s) => s.run.phase !== "running",
    SWEEP_TICKS,
    "the run to end",
  );
  // The frame that follows the tick that ended it, so what the screen shows is
  // the screen a cleared run left standing.
  await h.advance(1);
  await h.capture("run-cost", "the run's cost");

  assertEqual(ended.run.phase, "cleared", "the run this check reads after");
  assertEqual(
    (await h.snapshot()).screen,
    "results",
    "the screen a cleared run moves to (specs/ui.md § Run)",
  );

  const cost = ended.structure.cost;
  const { lines, figures } = await screenReading(h);
  assertTrue(
    figures.some((one) => Math.abs(one - cost) <= COST_TOLERANCE),
    `the cost of the crane the run was made with, ${cost.toFixed(2)}, among ` +
      "the figures the results screen draws (specs/ui.md § Results); it drew " +
      `[${lines.join(" | ")}]`,
  );
});
