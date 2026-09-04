// Deepcore — core-run/jettison-keeps-the-timer-running: dropping the Sample
// neither pauses nor resets its clock.
//
// `specs/items.md`: "the miner may jettison it, dropping it onto its current cell
// as a ground item ... The destabilization timer keeps running on the dropped
// Sample. Jettisoning neither pauses nor resets it."
//
// A Sample is posed carried with its timer part run, and the jettison control
// `specs/instrumentation.md` names is called. Three readings decide it: the
// Sample leaves the satchel and appears as a ground item on the cell the snapshot
// says the miner is in, the timer across the drop is the one it had rather than
// `CORE_TIMER` again, and a driven span afterwards takes it down by that span.
//
// The reset half is what the posed timer is for: a Sample dropped at a full
// ninety seconds could not tell a timer that carried on from one that started
// over.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertDeepEqual, assertEqual } from "../assert";
import { captureReplay, createHarness, type Harness } from "../harness";
import { elapse, openCampScene } from "./core-scene";

/** Well short of `CORE_TIMER`, so a restarted timer would be unmistakable. */
const POSED_TIMER = 40;

/** The span the dropped Sample's timer is measured over. */
const SPAN = 3;

/** Slack on a span read across whole frames. */
const TOLERANCE = 0.2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("drops the Sample on the miner's cell with its timer still running", async () => {
  openCampScene(h);
  h.debug.setCoreCarried(true);
  h.debug.setCoreTimer(POSED_TIMER);

  const run = await captureReplay(h, "drop", async () => {
    const before = h.snapshot();
    h.debug.jettison();
    const dropped = h.snapshot();
    await elapse(h, SPAN);
    return { before, dropped, later: h.snapshot() };
  });

  assertEqual(run.dropped.satchel.coreSample, false, "a Sample still carried");
  assertDeepEqual(
    run.dropped.coreGround,
    { col: run.before.miner.col, row: run.before.miner.row },
    "the cell the Sample was dropped on",
  );

  assertBetween(
    run.dropped.coreTimer ?? Number.NaN,
    POSED_TIMER - TOLERANCE,
    POSED_TIMER + TOLERANCE,
    "the timer across the drop",
  );
  assertBetween(
    (run.dropped.coreTimer ?? Number.NaN) - (run.later.coreTimer ?? Number.NaN),
    SPAN - TOLERANCE,
    SPAN + TOLERANCE,
    `seconds the dropped Sample's timer fell over ${SPAN}s`,
  );
});
