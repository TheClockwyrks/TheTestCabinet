// audio/motor-stops-on-an-abort — aborting a run stops the motor loop.
//
// specs/ui.md § Audio, the `motor` row: it "loops while a run is in progress and
// any axis's rate is nonzero, and is silent otherwise: a run that leaves the
// running phase stops it, whether it cleared, failed, or was aborted, whatever
// rates its axes were left holding". specs/program.md gives the abort: "The `back`
// action aborts a run early and returns to the build screen; an aborted run has no
// verdict."
//
// So an abort is the case where nothing about the run has concluded: no failure
// copy, no results screen, no cause — the run simply stops being in progress, and
// the drive has to go quiet with it. A build that stopped its loop from the
// clear and the failure alone leaves the yard humming on the build screen for the
// rest of the session.
//
// THE ABORT LANDS MID-MOVE, on a tick whose hoist is driving, so the loop is
// genuinely running when it is cut off: that is read back first, from BOTH of the
// probe's answers, because a build may loop by setting a source's `loop` flag or
// by re-scheduling the buffer end to end (validation/none/cues-init.js).
//
// SILENCE IS THEN READ THE SAME TWO WAYS over ten frames after the abort: no
// looping source is live, and nothing new starts. One frame is allowed first,
// since a cue a pose raises sounds on the frame that follows it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { HOIST_MAX_RATE } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** A hoist move long enough that the axis is still driving when the abort lands. */
const TAPE: readonly TapeStepSpec[] = [
  { kind: "move", commands: [{ axis: "hoist", target: 20, rate: HOIST_MAX_RATE }] },
];

/** Frames watched after the abort, for a loop that re-schedules rather than loops. */
const AFTER_FRAMES = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stops the motor loop when a run in progress is aborted", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);

  await h.cues();
  const driving = await runTicks(h, 10);
  assertTrue(
    driving.run.axes.hoist.rate !== 0,
    "the hoist driving when the abort lands, so the motor loop is running",
  );
  const sounding = [...(await h.loopingCues()), ...(await h.cues())];
  assertTrue(
    sounding.includes("motor"),
    "the motor loop running before the abort (specs/ui.md), so there is a loop " +
      "for the abort to stop",
  );

  await h.debug.abortRun();
  // A cue a pose raises sounds on the FRAME THAT FOLLOWS it, never at the call.
  await h.advance(1);
  const aborted = await h.snapshot();
  assertEqual(aborted.run.phase, "idle", "the run the abort put back");
  assertEqual(aborted.screen, "build", "the screen the abort returns to");

  await h.cues();
  await h.advance(AFTER_FRAMES);
  const started = await h.cues();
  const looping = await h.loopingCues();

  assertTrue(
    !looping.includes("motor"),
    `no motor loop live over the ${AFTER_FRAMES} frames after the abort: a run ` +
      "that leaves the running phase stops it, whatever rates its axes were " +
      "left holding (specs/ui.md) — the loop is still running",
  );
  assertTrue(
    !started.includes("motor"),
    `no motor sound started over the ${AFTER_FRAMES} frames after the abort ` +
      "(specs/ui.md) — the loop is still being fed",
  );

  await h.capture("aborted", "The build screen after the abort");
});
