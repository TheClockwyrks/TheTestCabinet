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

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNotNull } from "../assert";
import { HOIST_MAX_RATE, HOIST_START, RUN_SPEEDS, TICK_HZ } from "../constants";
import {
  clearAll,
  createHarness,
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

/** One hoist move: some tens of ticks, then the tape runs out and the run clears. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "hoist", target: HOIST_START + 1, rate: HOIST_MAX_RATE },
    ],
  },
];

/** The faster watch: `RUN_SPEEDS[2]` is `4`. */
const FAST = 2;

/** Frames the sweep is given: enough at either speed. */
const CAP = 400;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("records the ending tick's own clock, whatever speed the run was watched at", async () => {
  /** Stand the world up, clear the site at `speedIndex`, and answer the end. */
  const clear = async (speedIndex: number): Promise<GantrySnapshot> => {
    await openSite(h, SITE);
    await clearAll(h);
    await standMinimalCrane(h);
    await poseTape(h, TAPE);
    await startRun(h);
    if (speedIndex !== 0) await h.debug.setSpeedIndex(speedIndex);
    return runUntil(
      h,
      (s) => s.run.phase !== "running",
      CAP,
      "the tape to run out and the run to end",
    );
  };

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

  // The same tape again, watched at the speed a run starts at.
  await h.debug.clearBest(SITE);
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
