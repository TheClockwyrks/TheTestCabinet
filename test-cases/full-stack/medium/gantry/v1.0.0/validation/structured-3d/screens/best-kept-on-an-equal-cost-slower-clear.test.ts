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
// record "the crane's cost and the run clock at the tick it ended on", and the
// tape below takes the best part of a second, so the clear this check makes is
// slower than the score standing — the case the rule refuses.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNotNull } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
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

/** A move long enough that the clear it ends takes longer than `BEST_TIME`. */
const TAPE: readonly TapeStepSpec[] = [
  { kind: "move", commands: [{ axis: "grip", target: 30, rate: GRIP_MAX_RATE }] },
];

/** The time on the standing score: lower than any run this tape can make. */
const BEST_TIME = 0.1;

/** Ticks the run is given to reach its verdict. */
const END_CAP = 600;

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

  await h.advance(1);
  await h.capture(
    "best-kept",
    "The recorded best after a slower clear of equal cost",
  );
});
