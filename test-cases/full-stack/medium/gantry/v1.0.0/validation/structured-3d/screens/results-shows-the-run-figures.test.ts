// screens/results-shows-the-run-figures — the results screen shows the run's own
// cost and its clock.
//
// specs/ui.md § Results: "`results` shows `CLEARED_TEXT` (`SITE CLEARED`), the
// run's cost and time beside the site's par cost and par time". This check
// decides the first half of that sentence — the figures the RUN earned — and the
// site's par figures are a separate check.
//
// The two figures are the ones specs/program.md § Starting and ending a run says
// a clear records: "A run that ends cleared records the site's score, the crane's
// cost and the run clock at the tick it ended on". So the cost is the crane's own
// (specs/structure.md § Cost and the budget) and the time is the run clock,
// "`tick / TICK_HZ` seconds".
//
// BOTH FIGURES ARE READ OFF THE BUILD'S OWN SNAPSHOT rather than written in here:
// what the screen has to show is the cost of the crane the run was made with and
// the clock that run ended on, whatever those came out as, so the check compares
// the drawn figures against `structure.cost` and `run.time`.
//
// THE RUN IS ONE SLEW MOVE, AND ITS CLOCK IS A WHOLE NUMBER OF SECONDS. The
// controller of specs/program.md § Axis motion is exact and deterministic, so a
// turn of the arm takes a fixed count of ticks, and `30` degrees at
// `SLEW_MAX_RATE` is the turn whose count is exact by construction rather than
// by arithmetic luck. At `SLEW_ACCEL` (`30`) the arm takes one whole second to
// reach `SLEW_MAX_RATE` (`30`) and one whole second to brake back to rest, and
// those two ramps between them cover `30` degrees — so this turn is exactly the
// ramp up and the ramp down with no cruise between, the critical profile, and the
// axis settles ONTO the target rather than crossing it somewhere inside a tick.
// The arm arrives on tick `119`; the step is found complete at the top of tick
// `120` (specs/program.md § The tick pipeline), and that tick, finding no step
// left, is the tick the run ends on. The clock reads two seconds. A target either
// side of the critical one lands the ending a tick or two elsewhere, which is why
// the check turns exactly this far.
//
// That matters because how many decimals a build shows is its own business: at a
// whole number of seconds, `2`, `2.0` and `2.00` are the same figure. And `2` is
// a figure nothing else on this screen carries — the crane costs `981.43`, site
// 1's par is `2400` and `18`, and the standing best below is `500` and `3`.
//
// THE RUN IS DRIVEN IN BULK TO THE TICK BEFORE IT ENDS, and swept one tick at a
// time only over the handful of ticks around the ending. The ending is still
// EARNED — the run's own rules decide the clear on the tick they reach it, and
// nothing here poses a phase — and this check simply stops asking after every
// single tick on the way there. Driving the whole run a tick at a time cost three
// hundred crossings into the page to learn what the last two of them say.
//
// A BETTER SCORE IS RECORDED BEFORE THE RUN, so a screen that shows only the
// site's best cannot pass for one that shows the run's. specs/ui.md § Results: a
// later clear replaces the best "when its cost is lower, or equal with a lower
// time", and this crane costs far more than the score posed here, so the best
// stays a different pair of numbers from the run's.
//
// The yard is emptied and the crane is the minimal one, so nothing is lifted and
// the run clears on the tape alone ("cleared if every load is `placed`",
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
import { drawnText, toDrawCall, type RecordedOp } from "../case-harness/index";

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
 * A crane's cost is a length times a rate per unit and comes out fractional, and
 * how many decimals of it a build shows — or whether it rounds or truncates to
 * whole cost units — is presentation, so a unit either way is honest.
 */
const COST_TOLERANCE = 1;

/**
 * How far a drawn clock may sit from the clock it presents.
 *
 * The run ends on a whole second by construction, so `2`, `2.0` and `2.00` all
 * read back as the figure itself and half a second is room to spare — and it is
 * deliberately less than a whole one, so a stray figure a screen happens to carry
 * beside the clock cannot stand in for it.
 */
const TIME_TOLERANCE = 0.5;

/**
 * Every run of text the last frame drew on the screen layer.
 *
 * specs/overview.md fixes where a readout lives — "over it the screen-space
 * readouts are drawn on a 2D layer composited on top of the picture, laid out in
 * logical stage units" — so the words a screen shows are the runs of text that
 * layer's frame issued, whatever font, colour, or arrangement a build chose for
 * them.
 */
async function screenText(harness: Harness): Promise<string[]> {
  const ops = (await harness.screenOps()) as RecordedOp[];
  return drawnText(ops.map(toDrawCall));
}

/** Every number the drawn text carries, as figures rather than characters. */
function drawnNumbers(runs: readonly string[]): number[] {
  return runs.flatMap((run) => {
    const digits = run.replace(/(?<=\d)[\s,'](?=\d)/g, "");
    return [...digits.matchAll(/\d+(?:\.\d+)?/g)].map((one) => Number(one[0]));
  });
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows the cost of the crane the run was made with and the clock it ended on", async () => {
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
  await h.capture("results-figures", "the run's cost and time");

  assertEqual(ended.run.phase, "cleared", "the run this check reads after");
  assertEqual(
    (await h.snapshot()).screen,
    "results",
    "the screen a cleared run moves to (specs/ui.md § Run)",
  );

  const cost = ended.structure.cost;
  const time = ended.run.time;
  const shown = await screenText(h);
  const figures = drawnNumbers(shown);
  assertTrue(
    figures.some((one) => Math.abs(one - cost) <= COST_TOLERANCE),
    `the cost of the crane the run was made with, ${cost.toFixed(2)}, among ` +
      "the figures the results screen draws (specs/ui.md § Results); it drew " +
      `[${shown.join(" | ")}]`,
  );
  assertTrue(
    figures.some((one) => Math.abs(one - time) <= TIME_TOLERANCE),
    `the run clock the run ended on, ${time.toFixed(2)} seconds, among the ` +
      "figures the results screen draws (specs/ui.md § Results); it drew " +
      `[${shown.join(" | ")}]`,
  );
});
