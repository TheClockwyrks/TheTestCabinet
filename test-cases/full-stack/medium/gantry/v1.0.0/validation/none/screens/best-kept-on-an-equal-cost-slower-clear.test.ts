// results — a clear of equal cost and a higher time leaves the best standing.
//
// `specs/ui.md` § Results: "A clear records the site's best score: the first
// clear as it stands, and a later clear replaces it when its cost is lower, or
// equal with a lower time." This check decides the edge that rule turns on:
// equal cost with a HIGHER time is not lower, so the recorded score stands. The
// first clear, the strictly cheaper clear, and the equal-cost faster clear are
// each their own point.
//
// THE STANDING SCORE IS POSED WITH THE CRANE'S OWN COST, read back off the
// snapshot rather than written into this file. `specs/instrumentation.md` gives
// `setBest(index, cost, time)`: "Records `{ cost, time }` as site `index`'s best
// score, whatever it held." Posing the cost the run is about to report is what
// makes the two EQUAL — the rule's precondition — without this check having to
// engineer a crane that costs some round number, which would be asserting a
// figure the specification never fixed.
//
// THE POSED TIME IS WELL UNDER THE RUN'S. `specs/program.md` has a cleared run
// record "the crane's cost and the run clock at the tick it ended on", and a run
// that ends at all has ticked at least once, so `BEST_TIME` is set under a single
// tick of run clock (`1 / TICK_HZ`, `0.0167`) and the clear this check makes is
// slower than the score standing — the case the rule refuses.
//
// THE TAPE IS THE SHORTEST MOVE THAT IS STILL A MOVE. What the rule turns on is
// the pair of scores, not the length of the run that reports the second one, so
// the tape pays the hoist out by a fiftieth of a unit: the run clears in a handful
// of ticks, and the gap between the two times is still hundreds of times the
// tolerance on either.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNotNull } from "../assert";
import { HOIST_MAX_RATE, HOIST_START, TICK_HZ } from "../constants";
import {
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

/** The site this check plays, and the entry of `best` it reads. */
const SITE = 0;

/**
 * The shortest move that is still a move: a fiftieth of a unit of hoist.
 *
 * `specs/program.md` accepts any target inside the axis's range, and the run ends
 * on the tick that finds no step left — so this clears in a handful of ticks and
 * still takes longer than `BEST_TIME`.
 */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "hoist", target: HOIST_START + 0.02, rate: HOIST_MAX_RATE },
    ],
  },
];

/** The time on the standing score: under one tick, so under any run's clock. */
const BEST_TIME = 1 / (2 * TICK_HZ);

/** Ticks the run is given to reach its verdict, from a move that takes ten. */
const END_CAP = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps the recorded best when a clear ties its cost and takes longer", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);

  const cost = (await h.snapshot()).structure.cost;
  assertGreaterThan(
    cost,
    0,
    "the cost of the crane the run will be made with (specs/structure.md)",
  );
  await h.debug.setBest(SITE, cost, BEST_TIME);
  assertEqual(
    (await h.snapshot()).best[SITE]?.cost,
    cost,
    "the cost of the score posed as the site's best " +
      "(specs/instrumentation.md)",
  );

  await startRun(h);
  const ended = await runUntil(
    h,
    (snapshot) => snapshot.run.phase !== "running",
    END_CAP,
    "the tape to run out and the site to clear",
  );
  assertEqual(
    ended.run.phase,
    "cleared",
    "the verdict a tape that runs out with every load placed reaches " +
      "(specs/program.md)",
  );
  assertEqual(
    ended.structure.cost,
    cost,
    "the cost the clear reports: the same crane, untouched by the run " +
      "(specs/program.md)",
  );
  assertGreaterThan(
    ended.run.time,
    BEST_TIME,
    "the run clock the clear ended on, which has to be the SLOWER of the two " +
      "for this to be the edge the rule refuses (specs/ui.md)",
  );

  const best = ended.best[SITE];
  await h.advance(1);
  await h.capture(
    "best-kept",
    "The recorded best after a slower clear of equal cost",
  );

  assertNotNull(best, "the site's recorded best score");
  assertEqual(
    best?.cost,
    cost,
    "the cost of the score standing after an equal-cost, slower clear " +
      "(specs/ui.md)",
  );
  assertEqual(
    best?.time,
    BEST_TIME,
    "the time of the score standing after an equal-cost, slower clear: a " +
      "later clear replaces the best only when its cost is lower, or equal " +
      "with a lower time (specs/ui.md)",
  );
});
