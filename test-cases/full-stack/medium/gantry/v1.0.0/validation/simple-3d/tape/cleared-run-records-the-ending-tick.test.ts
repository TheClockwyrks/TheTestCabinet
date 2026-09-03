// tape/cleared-run-records-the-ending-tick — a clear records the run clock at the
// tick the run ended on.
//
// `specs/program.md` § Starting and ending a run: "A run that ends cleared
// records the site's score, the crane's cost and the run clock at the tick it
// ended on". § The tick pipeline fixes what that clock is: "A tick that ends the
// run counts like any other … so the run clock the run ends on is that tick's own
// number over `TICK_HZ`."
//
// THE RECORDED FIGURE IS MEASURED AGAINST THE TICK THE RUN ENDED ON, read from
// the same snapshot, so the reading is `run.tick / TICK_HZ` exactly rather than a
// figure copied from anywhere else.
//
// AND THE RUN IS WATCHED TWICE, AT TWO SPEEDS, which is what separates the run
// clock from the wall clock. `specs/program.md`: "speed changes how many ticks a
// second of watching covers and nothing else." The first watch is at speed index
// `2` (`RUN_SPEEDS[2]`, `4`), where the same run takes a quarter of the watching;
// the second is at the index `0` a run starts at (`specs/state.md`). A build that
// recorded how long the player watched would record two different figures; the
// run clock is one figure, and it is the tick count over `TICK_HZ` both times.
//
// The site's score is cleared between the two, since `specs/ui.md` replaces a
// recorded score only when "its cost is lower, or equal with a lower time" — so
// the second run records as a first clear rather than being weighed against the
// first.
//
// THE YARD IS EMPTY, so the tick the tape runs out on is a clear: "cleared if
// every load is `placed`" (`specs/program.md`), which every load of an empty yard
// vacuously is. The requirement is about the clock a clear records, so the world
// holds only the crane the tape runs.
//
// THE CRANE AND THE TAPE ARE STOOD UP ONCE and both runs are made over them.
// `specs/state.md` § What a site opening does has an opening keep "that site's
// stored structure and tape" and return "the run to its idle placeholder", so
// reopening the site between the two watches is the whole of what putting the
// second run back to the start takes; only the loads it copies back in have to be
// swept out again. Rebuilding the crane a second time would drive twenty-one more
// edits through the editor's rules, which decide nothing here.
//
// AND THE TAPE IS THE SHORTEST ONE THAT ENDS: a hoist move of a twentieth of a
// unit, which the axis ramps up and brakes back down inside a fifth of a second.
// A dozen ticks is enough for `run.tick` to be a figure with room to be wrong in,
// and driving the axis further would only make the same clock bigger.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNotNull } from "../assert";
import { HOIST_MAX_RATE, HOIST_START, RUN_SPEEDS, TICK_HZ } from "../constants";
import {
  clearAll,
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  runUntil,
  standMinimalCrane,
  startRun,
  type GantrySnapshot,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The site the run clears, and the one whose score is read. */
const SITE = 0;

/** One short hoist move: a dozen ticks, then the tape runs out and it clears. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "hoist", target: HOIST_START + 0.05, rate: HOIST_MAX_RATE },
    ],
  },
];

/** The faster watch: `RUN_SPEEDS[2]` is `4`. */
const FAST = 2;

/** Frames the sweep is given: enough at either speed, with room to spare. */
const CAP = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("records the ending tick's own clock, whatever speed the run was watched at", async () => {
  /** Run the standing tape at `speedIndex`, and answer the state it ended in. */
  const clear = async (speedIndex: number): Promise<GantrySnapshot> => {
    await startRun(h);
    if (speedIndex !== 0) await h.debug.setSpeedIndex(speedIndex);
    return runUntil(
      h,
      (s) => s.run.phase !== "running",
      CAP,
      "the tape to run out and the run to end",
    );
  };

  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);

  await h.debug.clearBest(SITE);
  const fast = await clear(FAST);

  await h.capture("state", "The score a clear watched at 4x recorded");

  assertEqual(
    fast.run.phase,
    "cleared",
    "the run an empty yard's tape ends in (specs/program.md)",
  );
  assertEqual(
    fast.run.speedIndex,
    FAST,
    `the speed the first run was watched at, RUN_SPEEDS[${FAST}] ` +
      `(${RUN_SPEEDS[FAST]})`,
  );
  assertGreaterThan(
    fast.run.tick,
    1,
    "the ticks the cleared run took, so the recorded clock is a figure with " +
      "room to be wrong in",
  );
  const fastBest = fast.best[SITE];
  assertNotNull(fastBest, `the score the clear recorded for site ${SITE + 1}`);
  assertEqual(
    fastBest?.time,
    fast.run.tick / TICK_HZ,
    "the time the clear recorded: the run clock at the tick it ended on, " +
      "that tick's own number over TICK_HZ (specs/program.md)",
  );

  // The same crane and the same tape again, watched at the speed a run starts
  // at. Reopening the site puts the run back to its idle placeholder and keeps
  // the structure and the tape standing (specs/state.md); what it does bring
  // back is the site's own loads, which are swept out again.
  await h.debug.clearBest(SITE);
  await openSite(h, SITE);
  await emptyYard(h);
  const slow = await clear(0);

  assertEqual(
    slow.run.speedIndex,
    0,
    "the speed the second run was watched at (specs/state.md)",
  );
  assertEqual(
    slow.run.tick,
    fast.run.tick,
    "the tick the same tape over the same crane ended on at the slower " +
      "watch: the speed changes how many ticks a frame covers and nothing " +
      "else (specs/program.md)",
  );
  const slowBest = slow.best[SITE];
  assertNotNull(slowBest, `the score the second clear recorded`);
  assertEqual(
    slowBest?.time,
    fastBest?.time,
    "the time the second clear recorded, against the first's: the run clock " +
      "is the ending tick over TICK_HZ rather than the watching the player " +
      "did (specs/program.md)",
  );
});
