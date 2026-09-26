// campaign/reference-solution-completes — every reference solution of the course
// runs to completion.
//
// THE RULE. Every challenge of the course "is solvable: the build ships a
// reference solution for it ... whose run completes without faulting within
// `CAMPAIGN_REFERENCE_CYCLES` (`600`) cycles of the run's start"
// (`specs/modes/campaign.md`, The course). What completing is:
// "After the rises, if every set's tally has reached the challenge's `target`,
// the run completes: the status becomes `complete` and the metrics are recorded"
// (`specs/simulation.md`, Completion and metrics).
//
// THIS IS THE POINT THE WHOLE COURSE RESTS ON. Every other requirement about a
// challenge is about a document; this one is about the game actually being
// winnable, machine by machine, with the machine the build itself put forward as
// the answer.
//
// THE POSE, for each challenge in turn: the shipped challenge opened, its own
// reference solution loaded as the machine, and the run started through the
// surface — `startRun` "runs the game's run-start sequence"
// (`specs/instrumentation.md`) — with the completion switch left ON, because
// completion is exactly what is being read. Nothing else is posed: no mote is
// spawned, no pose is moved, no tally is set. The machine is the build's own and
// the run is its own.
//
// HOW THE BUDGET IS SPENT. The clock is driven `CAMPAIGN_REFERENCE_CYCLES` cycles
// of game time and no more, in chunks, stopping as soon as the run is no longer
// `running`. So "within 600 cycles" is enforced by the DRIVE rather than by
// reading a metric back: a run still running when the budget is gone has not
// completed within it, whatever it reports. A chunk runs in a single frame, and
// only the opening cycles of the recorded run take the frames a cycle is
// watchable at: "a frame may complete several cycles; each runs in full, in
// order" (`specs/simulation.md`), and "an interval of game time reaches the same
// state however it was divided into frames" (`specs/instrumentation.md`), so the
// division decides nothing.
//
// THE VERDICT, for every challenge of the course: within the budget the run
// reaches `sim.status` `complete`, and at that point every set the machine placed
// reports a tally that has reached the challenge's `target`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertNotNull,
} from "../assert";
import { CAMPAIGN_REFERENCE_CYCLES, FRAMES_PER_CYCLE } from "../constants";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  loadMachine,
  openChallenge,
  referenceSolution,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * How many cycles of the budget one drive spends before the status is read, and
 * it spends them in ONE frame: "a frame may complete several cycles; each runs
 * in full, in order" (`specs/simulation.md`), and "an interval of game time
 * reaches the same state however it was divided into frames"
 * (`specs/instrumentation.md`).
 */
const CHUNK = 20;

/**
 * How many cycles at the head of a recorded run take the watchable division.
 *
 * The recording opens on the machine moving rather than on a stop-motion of it,
 * and the budget after them runs a whole chunk to the frame. A run no recording
 * is taken of is driven a chunk to the frame throughout.
 */
const WATCHED_CYCLES = 2;

/**
 * Drive the live run until it stops being `running`, or until the reference's
 * whole budget of `CAMPAIGN_REFERENCE_CYCLES` cycles has been spent.
 */
async function runWithinTheBudget(h: Harness, watched: number): Promise<void> {
  let spent = 0;
  if (watched > 0) {
    await advanceCycles(h, watched, watched * FRAMES_PER_CYCLE);
    spent = watched;
  }
  while (spent < CAMPAIGN_REFERENCE_CYCLES) {
    const sim = (await h.snapshot()).sim;
    if (sim === null || sim.status !== "running") return;
    const run = Math.min(CHUNK, CAMPAIGN_REFERENCE_CYCLES - spent);
    await advanceCycles(h, run, 1);
    spent += run;
  }
}

it("completes every challenge of the course with its own reference machine", async () => {
  const count = (await h.snapshot()).campaign.count;
  assertGreaterThan(count, 0, "the campaign ships a course to read");

  for (let index = 0; index < count; index += 1) {
    const document = await referenceSolution(h, "campaign", index);
    await openChallenge(h, "campaign", index);
    const view = (await h.snapshot()).challenge;
    assertNotNull(view, `campaign challenge ${index + 1} opens in the editor`);
    assertNotNull(
      document ?? null,
      `campaign challenge ${index + 1} ships a reference solution`,
    );
    if (view === null || document === null) return;

    await loadMachine(h, document);
    await h.debug.startRun();

    // The opener's run is the recorded one, so the evidence is there whichever
    // challenge of the course turns out to fail.
    if (index === 0) {
      await captureReplay(h, "run", () =>
        runWithinTheBudget(h, WATCHED_CYCLES),
      );
    } else {
      await runWithinTheBudget(h, 0);
    }

    const at = `campaign challenge ${index + 1}`;
    const sim = (await h.snapshot()).sim;
    assertNotNull(sim, `${at}'s run is still live after its budget`);
    assertEqual(
      sim?.status,
      "complete",
      `${at}'s reference solution completes its run within CAMPAIGN_REFERENCE_CYCLES cycles of the run's start`,
    );

    const placed = (document.parts ?? []).filter((part) => part.kind === "set");
    for (const part of placed) {
      const product = part.index ?? -1;
      assertGreaterThanOrEqual(
        sim?.tallies[product] ?? -1,
        view.target,
        `${at}'s set on product ${product} has reached the challenge's target when the run completes`,
      );
    }
  }
});
