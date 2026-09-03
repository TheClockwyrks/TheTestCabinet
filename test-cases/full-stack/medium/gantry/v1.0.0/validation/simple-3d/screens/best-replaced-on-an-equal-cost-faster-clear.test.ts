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
import { assertClose, assertEqual, assertLessThan, assertNotNull } from "../assert";
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
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);

  const built = await h.snapshot();
  const cost = built.structure.cost;
  await h.debug.setBest(SITE, cost, BEATEN_TIME);

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

  await h.capture("state", "the results screen the equal-cost clear reached");
});
