// screens/best-kept-on-a-worse-clear — a costlier clear leaves the record
// standing.
//
// specs/ui.md, "Results": "A clear records the site's best score: the first
// clear as it stands, and a later clear replaces it when its cost is lower, or
// equal with a lower time." The rule is keyed on cost first, so a clear whose
// cost is HIGHER replaces nothing, however quick it was.
//
// THE POSED RECORD IS CHEAPER AND SLOWER, and that is the whole point of the
// scenario. A record of `500` at `5` seconds is beaten on time by this run and
// beaten by nothing else, so a build that replaced the record here is one
// reading the time before the cost — the single mistake this rule has. A record
// that was slower AND costlier would be replaced for the right reason by a build
// with the rule backwards, and would decide nothing.
//
// The yard is emptied and the smallest crane that stands runs one short move
// step: specs/program.md ends a spent tape "cleared if every load is `placed`",
// and a yard holding no load has every load placed vacuously. `500` is well
// under that crane's cost and `5` seconds well over that tape's run, both of
// which the check reads back before it decides.
//
// THE RUN IS DRIVEN IN BATCHES, not a tick at a time. Nothing here is about the
// tick the clear lands on — what is read is the record afterwards, and
// `specs/state.md` leaves a finished run "as it ended until the next one starts",
// so its clock and its verdict are the same figures however many frames run past
// the end. `MAX_TICKS` is still the ceiling on a run that never ends, and a run
// that has not ended by then fails the phase reading below.

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
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  runTicks,
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

/** Frames driven per crossing while the run plays out. */
const BATCH = 60;

/** The standing record: cheaper than the crane below, and slower than its run. */
const KEPT_COST = 500;
const KEPT_TIME = 5;

/** Far below any gap either figure could honestly show. */
const TOL = 1e-6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves a cheaper record standing when a costlier clear beats it on time", async () => {
  await openSite(h, SITE);
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await h.debug.setBest(SITE, KEPT_COST, KEPT_TIME);

  const built = await h.snapshot();
  assertGreaterThan(
    built.structure.cost,
    KEPT_COST,
    `the crane's cost, which this scenario needs above the ${KEPT_COST} ` +
      "standing on the record",
  );

  let ended = await startRun(h);
  let driven = 0;
  while (ended.run.phase === "running" && driven < MAX_TICKS) {
    ended = await runTicks(h, BATCH);
    driven += BATCH;
  }
  await h.capture("state", "the results screen the costlier clear reached");

  assertEqual(
    ended.run.phase,
    "cleared",
    `the run to end cleared within ${MAX_TICKS} ticks, its tape spent with ` +
      "no load left unplaced (specs/program.md)",
  );
  assertLessThan(
    ended.run.time,
    KEPT_TIME,
    `the run clock at the clear, which this scenario needs below the ` +
      `${KEPT_TIME} seconds standing on the record`,
  );

  const best = ended.best[SITE] ?? null;
  assertNotNull(best, `the score standing on site ${SITE}`);
  assertClose(
    best!.cost,
    KEPT_COST,
    TOL,
    "the recorded best cost, which a costlier clear does not replace " +
      "(specs/ui.md)",
  );
  assertClose(
    best!.time,
    KEPT_TIME,
    TOL,
    "the recorded best time, which a costlier clear does not replace " +
      "(specs/ui.md)",
  );
});
