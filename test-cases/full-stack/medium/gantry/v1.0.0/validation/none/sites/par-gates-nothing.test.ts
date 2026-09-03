// sites/par-gates-nothing — a clear that beats neither par figure is still a
// clear.
//
// specs/sites.md, the preamble on par figures: "Par figures are targets to beat,
// shown beside a clear's score; they gate nothing." specs/program.md fixes what
// a clear IS, and says nothing of par: "A tick that finds no live step and no
// step left to take is the tick the run ends on: cleared if every load is
// `placed`, otherwise failed as `loads-unplaced`." specs/ui.md then has the
// cleared run record the site's score and unlock the next site.
//
// THE FAILURE THIS CATCHES IS A BUILD THAT READ PAR AS A REQUIREMENT — a run
// that spent more than the par cost or took longer than the par time turned
// away at the last tick, or landed on the run screen with a failure cause, or
// cleared without recording the clear. Site 1 — First Lift is the site to decide
// it on: it has the smallest par time of the six (`18` seconds against Site 5's
// `101`), and its par is `cost 2400, time 18` against a budget of `3000`, so
// there is room between the target and the ceiling for a crane that misses par
// and is still legal.
//
// THE CRANE MISSES PAR ON COST BY BEING PAID FOR. It is the site's reference
// crane with six counterweights hung on it, four on the anchor nodes themselves
// and two on the ring's bottom flange, at `COUNTERWEIGHT_COST` (`40`) each. That
// buys the cost past `2400` without changing what the crane can do: an anchor
// node "is held immovable" (specs/world.md), so weight hung there goes straight
// into the ground. `poseCrane` fails this check if any of it was refused, so the
// crane graded is the crane described.
//
// THE RUN MISSES PAR ON TIME BY BEING SLOW. The tape is one move step, the hoist
// let out `0.95` units at `0.05` a second — a rate "greater than `0` and at most
// the axis's max rate", which specs/program.md accepts — so the step alone takes
// nineteen seconds of run clock against a par of eighteen. Nothing else moves,
// so the long run is a long run and not a risk of collapse.
//
// NINETEEN SECONDS OF RUN CLOCK IS THIS CHECK'S IRREDUCIBLE COST, and the route
// spends nothing else. The clock is the tick count over `TICK_HZ` and no pose in
// specs/instrumentation.md writes it, so a clear reached past a par time of
// eighteen seconds has to be TICKED past eighteen seconds — the one thing here
// that cannot be posed. What the route refuses to spend is a crossing into the
// page per tick: the ticks are driven as two batched runs, one to `18.1` seconds
// where the run is already past par and still spending its step, and one that
// carries it past the end of the step, rather than swept a tick at a time. The
// tape is cut to the shortest that outlasts par rather than left at the
// twenty-four seconds an arbitrary distance gave it, and the watch speed is left
// where the run starts it: posing `setSpeedIndex` would cover the same run clock
// in a quarter of the frames, and would make this item fail on a build whose
// only fault was in the watch speed — a fault that belongs to another item.
//
// THE LOAD IS PLACED THROUGH THE SURFACE, because what this point is about is
// the verdict a spent tape reaches and not the lift that gets there.
// specs/instrumentation.md: `setLoadPhase` to `"placed"` "sets the load down
// exactly as a successful `release` leaves it", and "none of them reaches a
// verdict: the run's own rules decide clearing". So the run is left to end
// itself, on its own tick, with every load placed and both figures worse than
// par.
//
// THE YARD HOLDS ONE LOAD AND NOTHING ELSE: the crate Site 1 asks for, cleared
// and added back, so the clear this point reads is a clear with a load in it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import { HOIST_START } from "../constants";
import {
  DESIGNS,
  addOneLoad,
  createHarness,
  emptyYard,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  startRun,
  ticksFor,
  type CraneDesign,
  type Harness,
  type LatticeNode,
  type TapeStepSpec,
} from "../harness";

const SITE = 0;

/** specs/sites.md § Site 1 — First Lift, the `Par` row. */
const PAR_COST = 2400;
const PAR_TIME = 18;

/** The same section's `Budget` row: the ceiling the crane stays under. */
const BUDGET = 3000;

/**
 * Six counterweights on nodes the reference crane already uses: the four anchors,
 * where the weight goes straight into the ground, and two bottom-flange nodes.
 */
const WEIGHTS: readonly LatticeNode[] = [
  [0, 0, 0],
  [2, 0, 0],
  [0, 0, 2],
  [2, 0, 2],
  [0, 2, 0],
  [2, 2, 2],
];

/** Site 1's reference crane, paid up past its own par cost. */
const CRANE: CraneDesign = {
  ...DESIGNS[0]!,
  name: "First Lift, weighted past par",
  counterweights: [...DESIGNS[0]!.counterweights, ...WEIGHTS],
};

/** The load Site 1 asks for (specs/sites.md § Site 1 — First Lift). */
const LOAD = {
  from: { x: 10, y: 2, z: 0, yaw: 0 },
  to: { x: 0, y: 2, z: 10, yaw: 0 },
};

/**
 * Let the hoist out `0.95` units at `0.05` a second: nineteen seconds of tape,
 * a second past Site 1's par time and no longer. The ramp `HOIST_ACCEL` (`6`)
 * puts on and takes off at this rate is eight milliseconds at each end, so the
 * step is nineteen seconds to well inside a tick.
 */
const SLOW_RATE = 0.05;
const HOIST_TARGET = HOIST_START + 0.95;
const STEP_TIME = 19;
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "hoist", target: HOIST_TARGET, rate: SLOW_RATE }],
  },
];

/** Past par by a tenth of a second, and still a second short of the step. */
const PAST_PAR = ticksFor(PAR_TIME + 0.1);

/** From there to half a second past the end of the step, and so past the end. */
const TO_THE_END = ticksFor(STEP_TIME + 0.5) - PAST_PAR;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("clears the site on a run whose cost and time both miss par", async () => {
  await openSite(h, SITE);
  await emptyYard(h);
  await poseCrane(h, CRANE);
  await addOneLoad(h, "crate", 40, LOAD.from, LOAD.to);
  await poseTape(h, TAPE);

  const cost = (await h.snapshot()).structure.cost;
  assertGreaterThan(
    cost,
    PAR_COST,
    "the crane's cost, above Site 1's par cost of 2400 and so a clear that " +
      "misses it (specs/sites.md § Site 1 — First Lift)",
  );
  assertTrue(
    cost <= BUDGET,
    "the crane's cost, inside Site 1's budget of 3000, so nothing but par is " +
      "missed (specs/structure.md)",
  );

  await startRun(h);
  await h.debug.setLoadPhase(0, "placed");

  // Two batched crossings: to past par with the step still live, then past the
  // end of the step, where the run's own last tick has decided the verdict.
  const running = await runTicks(h, PAST_PAR);
  assertEqual(
    running.run.phase,
    "running",
    "the run at 18.1 seconds, past par and still spending the slow step " +
      "(specs/program.md)",
  );
  assertGreaterThan(
    running.run.time,
    PAR_TIME,
    "the run clock while the run is still going, already past Site 1's par " +
      "time of 18 (specs/sites.md § Site 1 — First Lift)",
  );

  const ended = await runTicks(h, TO_THE_END);

  await h.capture(
    "over-par",
    "The site cleared with both figures worse than par",
  );

  assertEqual(
    ended.run.phase,
    "cleared",
    "the verdict of a spent tape with every load placed, whatever the cost " +
      "and the time (specs/sites.md, specs/program.md)",
  );
  assertGreaterThan(
    ended.run.time,
    PAR_TIME,
    "the run clock the clear was reached on, past Site 1's par time of 18 " +
      "(specs/sites.md § Site 1 — First Lift)",
  );
  assertTrue(
    ended.cleared[SITE] === true,
    "Site 1 recorded as cleared by a run that beat neither par figure " +
      "(specs/ui.md)",
  );
});
