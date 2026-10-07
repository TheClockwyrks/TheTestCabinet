// tape/failing-tick-counts — the tick that ends a run counts like any other.
//
// `specs/program.md` § The tick pipeline: "A tick that ends the run counts like
// any other, whatever stage it reached and whether it ended cleared or failed, so
// the run clock the run ends on is that tick's own number over `TICK_HZ`." A run
// that ends at stage 1 of its `n`th tick therefore reads `n`, not `n - 1`, and
// its clock reads `n / TICK_HZ`.
//
// THE TICKS ARE COUNTED OUTSIDE THE GAME. The check drives one tick at a time and
// keeps its own tally of how many it drove since the start, and the tally is what
// `run.tick` is measured against — a reading taken from the same counter it is
// checking would decide nothing. `specs/state.md` fixes where the count starts:
// "`run.tick` reads `0` immediately after" a start, and "the run's first tick is
// the first tick the frame loop takes after the start, numbered `1`".
//
// THE RUN ENDS AT STAGE 1 OF A TICK WELL INSIDE ITS TAPE, which is the case that
// tells the two answers apart. The first step is an ordinary hoist move, short
// but several ticks long — long enough that the failing tick is one of many and a
// tally that dropped it is visible, and no longer than that, since every tick
// beyond the first few says the same thing again; the second commands the hoist
// below `HOIST_MIN` (`1`),
// which `specs/program.md` judges when the step starts — "A step whose command
// targets a value outside its axis's range at that moment ends the run as
// `command-out-of-range`" — so the failing tick is the tick after the first step
// arrives, and it fails before reaching any later stage. A build that stopped
// counting on the tick that failed would be one short of the driven tally.
//
// The yard is emptied and the crane is the minimal one: the requirement is about
// the clock, so nothing else stands in the world.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { HOIST_MAX_RATE, HOIST_MIN, HOIST_START, TICK_HZ } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type GantrySnapshot,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** One ordinary move, then a target the hoist's range does not hold. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "hoist", target: HOIST_START + 0.02, rate: HOIST_MAX_RATE },
    ],
  },
  {
    kind: "move",
    commands: [{ axis: "hoist", target: HOIST_MIN - 1, rate: HOIST_MAX_RATE }],
  },
];

/** Ticks the drive is given: the first step arrives in under ten. */
const CAP = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("counts the tick a failure ends the run on, and clocks it at tick / TICK_HZ", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  const started = await startRun(h);
  assertEqual(started.run.tick, 0, "run.tick immediately after the start");

  // The check's own tally of the ticks it drove, kept outside the game.
  let driven = 0;
  let ended: GantrySnapshot = started;
  while (driven < CAP && ended.run.phase === "running") {
    ended = await runTicks(h, 1);
    driven += 1;
  }

  await h.capture("state", "The run clock at the tick a failure ended it");

  assertEqual(
    ended.run.phase,
    "failed",
    "the run this tape ends: its second step commands the hoist below " +
      `HOIST_MIN (${HOIST_MIN}) (specs/program.md)`,
  );
  assertEqual(
    ended.run.cause,
    "command-out-of-range",
    "the cause a target outside its axis's range ends the run with",
  );
  assertGreaterThan(
    driven,
    1,
    "the ticks driven before the failure, so the failing tick is one of many " +
      "and a count that dropped it is visible",
  );
  assertEqual(
    ended.run.tick,
    driven,
    "run.tick on the tick the run ended: the tick that ends a run counts " +
      "like any other, so it is the number of ticks driven since the start " +
      "(specs/program.md)",
  );
  assertEqual(
    ended.run.time,
    driven / TICK_HZ,
    "the run clock the run ended on, that tick's own number over TICK_HZ " +
      "(specs/program.md)",
  );
});
