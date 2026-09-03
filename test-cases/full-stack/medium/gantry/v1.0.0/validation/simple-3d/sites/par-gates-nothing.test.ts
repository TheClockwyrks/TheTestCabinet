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
// it on: its par is `cost 2400, time 18` against a budget of `3000`, so there is
// room between the target and the ceiling for a crane that misses par and is
// still legal.
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
// let out `1.2` units at `0.05` a second — a rate "greater than `0` and at most
// the axis's max rate", which specs/program.md accepts — so the step alone takes
// twenty-four seconds of run clock against a par of eighteen. Nothing else moves,
// so the long run is a long run and not a risk of collapse.
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
import { COUNTERWEIGHT_COST, HOIST_START } from "../constants";
import {
  DESIGNS,
  addOneLoad,
  createHarness,
  emptyYard,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  runUntil,
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

/** Let the hoist out 1.2 units at 0.05 a second: twenty-four seconds of tape. */
const SLOW_RATE = 0.05;
const HOIST_TARGET = HOIST_START + 1.2;
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "hoist", target: HOIST_TARGET, rate: SLOW_RATE }],
  },
];

/** Well past par, and still short of the step: the run is driven in two parts. */
const FIRST_LEG = ticksFor(PAR_TIME + 2);

/** The rest of the step, and the tick after it that ends the run. */
const REST = ticksFor(20);

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

  // Driven in one crossing to past par, then a tick at a time to the end, so the
  // sweep that must reach a verdict is short.
  const running = await runTicks(h, FIRST_LEG);
  assertEqual(
    running.run.phase,
    "running",
    "the run at 20 seconds, still spending the slow step (specs/program.md)",
  );

  const ended = await runUntil(
    h,
    (s) => s.run.phase !== "running",
    REST,
    "the run to end once the tape is spent",
  );

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
    (await h.snapshot()).cleared[SITE] === true,
    "Site 1 recorded as cleared by a run that beat neither par figure " +
      "(specs/ui.md)",
  );
});
