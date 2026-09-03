// audio/run-start-cue — starting a run sounds the run-start cue.
//
// specs/ui.md § Audio: "`run-start` | a run starts". specs/program.md says the
// same thing from the run's side: "A started run plays the `run-start` cue, moves
// to the run screen, and ticks until it ends."
//
// THE START IS AN ACCEPTED ONE. A start is refused when the structure has a
// readiness issue or the tape is empty (specs/program.md), and a refused start is
// silent, so the crane is stood up and a tape appended before the start and the
// run's phase is read back: what sounds here is a run that began.
//
// The queue is drained on the frame before the start, because standing a crane up
// is twenty-one placing edits and each of them sounds `place`.
//
// It asks whether the cue SOUNDED rather than how many sources it took: one cue
// may reach the bus as several starts over the same decoded buffer
// (validation/none/cues-init.js).

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual } from "../assert";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** A tape that moves one axis a short way: enough for a run to be a run. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "hoist", target: HOIST_START + 2, rate: HOIST_MAX_RATE }],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("plays the run-start cue when a run starts", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await h.advance(1);
  await h.cues();

  const started = await startRun(h);
  // A cue a pose raises sounds on the FRAME THAT FOLLOWS it, never at the call.
  await h.advance(1);
  const played = await h.cues();

  assertEqual(started.run.phase, "running", "the run the start began");
  assertContains(
    played,
    "run-start",
    "the cue a run starting plays (specs/ui.md)",
  );

  await h.capture("start", "The run the start cue opened");
});
