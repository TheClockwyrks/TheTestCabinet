// screens/best-replaced-on-an-equal-cost-faster-clear — an equal cost is broken
// by the time.
//
// specs/ui.md, "Results": "A clear records the site's best score: the first
// clear as it stands, and a later clear replaces it when its cost is lower, or
// equal with a lower time." This point is the second replacing case, and the one
// that says the comparison is not on cost alone: with the costs equal, the lower
// time takes the record.
//
// THE POSED RECORD CARRIES THIS VERY CRANE'S COST, read off the structure rather
// than written here, so the two costs are equal by construction on any build that
// costs a crane as specs/structure.md says. Its time is far above anything this
// tape can take, so the only rule that can replace it is the tie-break — a build
// that replaced only on a strictly lower cost fails here, which is the mistake
// the "or equal with a lower time" clause rules out.
//
// The yard is emptied and the smallest crane that stands runs one short move
// step: specs/program.md ends a spent tape "cleared if every load is `placed`",
// and a yard holding no load has every load placed vacuously.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertClose,
  assertEqual,
  assertLessThan,
  assertNotNull,
} from "../assert";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  TICK_DT,
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  runTicks,
  runUntil,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

const SITE = 0;

const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "hoist", target: HOIST_START + 0.5, rate: HOIST_MAX_RATE },
    ],
  },
];

/**
 * The whole run's cap, in ticks: two seconds of run clock for a move that takes
 * under one. Past it the item fails rather than falling through to a reading of
 * a run still in progress.
 */
const MAX_TICKS = 120;

/**
 * Ticks driven in one call before the ending is swept for.
 *
 * The tape's one hoist move of half a unit takes about `35` ticks at
 * HOIST_ACCEL, and the tick after it arrives finds no step left and ends the run.
 * Half a unit rather than a whole one because nothing here reads the distance:
 * what the record is compared against is the run clock the build itself reports,
 * and a clock of `0.58` seconds decides a build that records `0` by seventy
 * times the tolerance.
 * `runTicks` drives the span in ONE crossing into the page; `runUntil` reads the
 * state back after every tick, which is what the ending needs and what the
 * approach to it does not. So the approach is driven and the ending is swept.
 *
 * Nothing is asserted off the driven span: the phase, the clock and the record
 * below are all read from the sweep's own snapshot, so the clear is still earned
 * by real ticks and still fails the item loudly if it never comes.
 */
const DRIVEN = 45;

/** The standing record's time: far above anything this one-step tape can take. */
const BEATEN_TIME = 60;

const COST_TOL = 0.01;
const TIME_TOL = TICK_DT / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("replaces a record of equal cost when the clear's time is lower", async () => {
  await openSite(h, SITE);
  // The yard is emptied and nothing else is. A site opened after a reset
  // carries an empty structure and an empty tape (specs/state.md), and the
  // crane and the tape below are posed onto them; clearing either again would
  // drive surface this requirement does not concern.
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);

  const built = await h.snapshot();
  const cost = built.structure.cost;
  await h.debug.setBest(SITE, cost, BEATEN_TIME);

  await startRun(h);
  await runTicks(h, DRIVEN);
  const ended = await runUntil(
    h,
    (s) => s.run.phase !== "running",
    MAX_TICKS - DRIVEN,
    "the run to end",
  );
  await h.capture("state", "the results screen the equal-cost clear reached");

  assertEqual(
    ended.run.phase,
    "cleared",
    "the run to end cleared, its tape spent with no load left unplaced " +
      "(specs/program.md)",
  );
  assertLessThan(
    ended.run.time,
    BEATEN_TIME,
    `the run clock at the clear, which this scenario needs below the ` +
      `${BEATEN_TIME} seconds standing on the record`,
  );

  const best = ended.best[SITE] ?? null;
  assertNotNull(best, `the score standing on site ${SITE}`);
  assertClose(
    best!.time,
    ended.run.time,
    TIME_TOL,
    "the recorded best time, which a clear of equal cost and lower time " +
      "replaces (specs/ui.md)",
  );
  assertClose(
    best!.cost,
    cost,
    COST_TOL,
    "the recorded best cost, unchanged because the two clears cost the same",
  );
});
