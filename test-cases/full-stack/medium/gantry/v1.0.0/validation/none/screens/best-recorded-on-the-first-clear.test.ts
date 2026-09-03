// screens/best-recorded-on-the-first-clear — the first clear is recorded as it
// stands.
//
// specs/ui.md, "Results": "A clear records the site's best score: the first
// clear as it stands, and a later clear replaces it when its cost is lower, or
// equal with a lower time." This point is the first half — with no score
// standing, the clear's own score is what is recorded. specs/program.md fixes
// what that score IS: "A run that ends cleared records the site's score, the
// crane's cost and the run clock at the tick it ended on".
//
// So both figures are read off the very build and run that produced them rather
// than written here: the crane's cost is the structure's own `cost`, which a run
// leaves untouched ("the structure, the tape, and the loads' starting poses are
// untouched"), and the run clock is `run.time`, which specs/state.md reports as
// `tick / TICK_HZ`. A validator that hard-coded either would be grading this
// crane rather than the rule.
//
// `clearBest` empties the site's record first, so what is read afterwards can
// only have been written by this clear.
//
// The yard is emptied and the smallest crane that stands runs one short move
// step: specs/program.md ends a spent tape "cleared if every load is `placed`",
// and a yard holding no load has every load placed vacuously. Nothing about the
// score turns on there being a lift, so there is none to fail on the way.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertEqual, assertNotNull } from "../assert";
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

/** Cost is a sum of lengths times rates; this is far below any real gap. */
const COST_TOL = 0.01;

/** Half a tick: a record one tick out is still decided against. */
const TIME_TOL = TICK_DT / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("records the first clear's own cost and time as the site's best", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.debug.clearBest(SITE);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);

  const built = await h.snapshot();
  const cost = built.structure.cost;

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

  const best = ended.best[SITE] ?? null;
  assertNotNull(
    best,
    `the score site ${SITE} records on its first clear (specs/ui.md)`,
  );
  assertClose(
    best!.cost,
    cost,
    COST_TOL,
    "the recorded best cost, which is the crane's cost (specs/program.md)",
  );
  assertClose(
    best!.time,
    ended.run.time,
    TIME_TOL,
    "the recorded best time, which is the run clock at the tick the run " +
      "ended on (specs/program.md)",
  );

  await h.capture("state", "the results screen the first clear recorded");
});
