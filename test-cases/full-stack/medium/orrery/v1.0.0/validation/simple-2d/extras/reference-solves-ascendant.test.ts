// extras/reference-solves-ascendant — the reference solution for Extras 5 runs
// Ascendant to completion.
//
// THE RULE. "Every Extras challenge ships a reference solution under the
// requirement `specs/modes/campaign.md` states for a course challenge"
// (`specs/modes/extras.md`, The shelf), and that requirement is that the
// challenge "is solvable: the build ships a reference solution for it, in the
// solution format, that is legal, places every rise and set, and whose run
// completes without faulting within `CAMPAIGN_REFERENCE_CYCLES` (`600`) cycles of
// the run's start" (`specs/modes/campaign.md`, The course).
//
// WHAT COMPLETING IS. "After the rises, if every set's tally has reached the
// challenge's `target`, the run completes: the status becomes `complete` and the
// metrics are recorded" (`specs/simulation.md`, Completion and metrics). The
// target is the challenge's own, and `specs/challenges.md` writes it as `6` for
// every Extra, which is `CONSTELLATION_TARGET`.
//
// WHAT THE MACHINE HAS TO DO, AND WHY THIS ROW IS DIFFERENT. Ascendant is the
// first Extra with TWO reagents — a `mercury` and a `saturn`, at rise indices `0`
// and `1` — and one `jupiter` out, with `ascend` in the tray. So its reference has
// to feed both rises and bring what they give it together, six times; a machine
// that used one input alone could never deliver the product at all. That is read
// back here as well as the completion: both of the challenge's rises are on the
// field when the run is started.
//
// THE POSE. The shipped challenge opened through `openChallenge("extras", 4)`,
// its OWN reference solution loaded as the machine through `loadSolution`, and
// the run started through `startRun` — which "runs the game's run-start sequence"
// and "skips the readiness condition the `play` action applies"
// (`specs/instrumentation.md`). The completion switch is left ON, because
// completion is exactly what is read. Nothing else is posed: no mote is spawned,
// no pose is moved, no tally is set. The machine is the build's own and so is the
// run.
//
// HOW THE BUDGET IS SPENT. The clock is driven `CAMPAIGN_REFERENCE_CYCLES` cycles
// of game time and no more, in chunks, stopping as soon as the run is no longer
// `running`. So "within 600 cycles" is enforced by the DRIVE rather than by
// reading a metric back afterwards: a run still running when the budget is gone
// has not completed within it, whatever it reports. The opening cycles are
// divided into the frames a cycle is watchable at, so the recording opens on the
// machine moving, and the budget after them runs a whole chunk to the frame: "a
// frame may complete several cycles; each runs in full, in order"
// (`specs/simulation.md`), and "an interval of game time reaches the same state
// however it was divided into frames" (`specs/instrumentation.md`), so the
// division decides nothing.
//
// THE VERDICT. Within the budget the run reaches `sim.status` `complete` — not
// `faulted`, and not still `running` — with no fault reported, and the tally of
// the challenge's one product has reached its target.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertNotNull,
  assertNull,
} from "../assert";
import {
  CAMPAIGN_REFERENCE_CYCLES,
  CONSTELLATION_TARGET,
  FRAMES_PER_CYCLE,
} from "../constants";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  loadMachine,
  openChallenge,
  referenceSolution,
  type Harness,
} from "../harness";

/** Which Extra this is, from `0`: challenge 5, Ascendant. */
const INDEX = 4;

/**
 * How many cycles of the budget one drive spends before the status is read, and
 * it spends them in ONE frame: "a frame may complete several cycles; each runs
 * in full, in order" (`specs/simulation.md`), and "an interval of game time
 * reaches the same state however it was divided into frames"
 * (`specs/instrumentation.md`).
 */
const CHUNK = 20;

/**
 * How many cycles at the head of the run are driven at the watchable division.
 *
 * The recording this drive is wrapped in opens on the machine moving rather than
 * on a stop-motion of it. The budget after them runs a whole chunk to the frame,
 * which reaches the same state on a small fraction of the frames.
 */
const WATCHED_CYCLES = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * Drive the live run until it stops being `running`, or until the reference's
 * whole budget of `CAMPAIGN_REFERENCE_CYCLES` cycles has been spent.
 */
async function runWithinTheBudget(): Promise<void> {
  await advanceCycles(h, WATCHED_CYCLES, WATCHED_CYCLES * FRAMES_PER_CYCLE);
  let spent = WATCHED_CYCLES;
  while (spent < CAMPAIGN_REFERENCE_CYCLES) {
    const sim = (await h.snapshot()).sim;
    if (sim === null || sim.status !== "running") return;
    const run = Math.min(CHUNK, CAMPAIGN_REFERENCE_CYCLES - spent);
    await advanceCycles(h, run, 1);
    spent += run;
  }
}

it("completes Ascendant with the machine the build itself puts forward", async () => {
  const document = await referenceSolution(h, "extras", INDEX);
  await openChallenge(h, "extras", INDEX);
  const view = (await h.snapshot()).challenge;

  assertNotNull(view, "Extras 5 opens in the editor");
  assertNotNull(document ?? null, "Extras 5 ships a reference solution");
  if (view === null || document === null || document === undefined) return;

  const rises = document.parts.filter((part) => part.kind === "rise").length;
  assertEqual(
    rises,
    view.reagents.length,
    "Ascendant's reference feeds both of the challenge's reagents, which is what its two rises are",
  );

  await loadMachine(h, document);
  await h.debug.startRun();
  await captureReplay(h, "run", () => runWithinTheBudget());

  const sim = (await h.snapshot()).sim;
  assertNotNull(sim, "the run is still live when its budget has been spent");
  assertNull(
    sim?.fault ?? null,
    "the reference machine runs Ascendant without faulting",
  );
  assertEqual(
    sim?.status,
    "complete",
    "the reference machine completes Ascendant within CAMPAIGN_REFERENCE_CYCLES cycles of the run's start",
  );
  assertEqual(
    view.target,
    CONSTELLATION_TARGET,
    "Ascendant asks every set for CONSTELLATION_TARGET, as every challenge in this game does",
  );
  assertGreaterThanOrEqual(
    sim?.tallies[0] ?? -1,
    view.target,
    "the set on Ascendant's one product has reached that target when the run completes",
  );
});
