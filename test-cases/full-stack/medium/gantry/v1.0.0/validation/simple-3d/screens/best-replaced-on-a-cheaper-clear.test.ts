// screens/best-replaced-on-a-cheaper-clear — a cheaper clear takes the record.
//
// specs/ui.md, "Results": "A clear records the site's best score: the first
// clear as it stands, and a later clear replaces it when its cost is lower, or
// equal with a lower time." This point is the first of the two replacing cases:
// a lower cost, on its own, replaces the record.
//
// THE POSED RECORD IS COSTLIER AND FASTER, so cost is the only reason the
// replacement can happen. A record that was both costlier and slower would be
// replaced by a build that read either figure, and would decide nothing; here a
// build that let a higher time hold the record back fails, which is the mistake
// the rule's wording ("when its cost is lower") rules out.
//
// The replacement is read as the clear's OWN score rather than as a figure
// written here: specs/program.md fixes it as "the crane's cost and the run clock
// at the tick it ended on", so the check reads the structure's cost and the run's
// clock off the very run that produced them.
//
// The yard is emptied and the smallest crane that stands runs one short move
// step: specs/program.md ends a spent tape "cleared if every load is `placed`",
// and a yard holding no load has every load placed vacuously.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertClose,
  assertEqual,
  assertGreaterThan,
  assertLessThan,
  assertNotNull,
} from "../assert";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  TICK_DT,
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

const SITE = 0;

const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "hoist", target: HOIST_START + 1, rate: HOIST_MAX_RATE },
    ],
  },
];

const MAX_TICKS = 600;

/** The standing record: costlier than the crane below, and faster than its run. */
const BEATEN_COST = 2500;
const BEATEN_TIME = 0.05;

const COST_TOL = 0.01;
const TIME_TOL = TICK_DT / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("replaces a costlier record when the clear's cost is lower", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await h.debug.setBest(SITE, BEATEN_COST, BEATEN_TIME);

  const built = await h.snapshot();
  const cost = built.structure.cost;
  assertLessThan(
    cost,
    BEATEN_COST,
    `the crane's cost, which this scenario needs below the ${BEATEN_COST} ` +
      "standing on the record",
  );

  await startRun(h);
  const ended = await runUntil(
    h,
    (s) => s.run.phase !== "running",
    MAX_TICKS,
    "the run to end",
  );
  assertEqual(
    ended.run.phase,
    "cleared",
    "the run to end cleared, its tape spent with no load left unplaced " +
      "(specs/program.md)",
  );
  assertGreaterThan(
    ended.run.time,
    BEATEN_TIME,
    `the run clock at the clear, which this scenario needs above the ` +
      `${BEATEN_TIME} seconds standing on the record`,
  );

  const best = ended.best[SITE] ?? null;
  assertNotNull(best, `the score standing on site ${SITE}`);
  assertClose(
    best!.cost,
    cost,
    COST_TOL,
    "the recorded best cost, which the cheaper clear replaces (specs/ui.md)",
  );
  assertClose(
    best!.time,
    ended.run.time,
    TIME_TOL,
    "the recorded best time, which the cheaper clear replaces (specs/ui.md)",
  );

  await h.capture("state", "the results screen the cheaper clear reached");
});
