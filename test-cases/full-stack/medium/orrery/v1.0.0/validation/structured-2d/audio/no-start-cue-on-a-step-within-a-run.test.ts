// audio/no-start-cue-on-a-step-within-a-run — `step` on a run that is already
// live sounds nothing: it advances a run rather than starting one.
//
// THE RULE. `specs/ui.md` gives the cue one event: "| `start` | `CUES.start` | A
// run starts. |" `specs/editor.md` separates `step`'s two jobs: "`step` under the
// same condition starts the run paused at its settle. AFTER THAT, `step` acts
// immediately and always leaves the run paused: a run mid-cycle, running or
// paused, completes its current cycle to the boundary, and a run paused at a
// boundary runs one full cycle." A step within a run starts no run, so the cue's
// event has not occurred.
//
// THE CONFIGURATION. `BARE` opened as a bare run — a posed challenge, an empty
// machine, the completion switch held off, a live `running` run and an empty
// field — so the run under the press is one that began long before the watcher
// opened, and no boundary it crosses can deliver, fault or complete while the
// check listens.
//
// THE STEP IS READ, NOT ASSUMED. The status is `running` before the press and
// `paused` after it, and the cycle counter has moved on, so the silence belongs
// to a press that really ran the machine to its next boundary.
//
// THE VERDICT. No frame from the watcher's opening to the end of the frames run
// after the press sounds anything.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import { CUES } from "../constants";
import { BARE } from "../fixtures";
import {
  captureReplay,
  createHarness,
  openBareRun,
  stepAction,
  watchCues,
  type Harness,
} from "../harness";
import {
  FENCE_FRAMES,
  TAIL_FRAMES,
  openSilence,
  soundingFrames,
} from "./silence";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds nothing when step runs a live run to its next boundary", async () => {
  await openBareRun(h, { challenge: BARE });
  await openSilence(h);

  const heard = watchCues(h);
  await h.advance(FENCE_FRAMES);
  const before = await h.snapshot();
  assertEqual(
    before.sim?.status,
    "running",
    "the run is live and running before the press, so the press is a step within a run",
  );

  await captureReplay(h, "silent", async () => {
    await stepAction(h);
    await h.advance(TAIL_FRAMES);
  });

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "paused",
    "step always leaves the run paused, which is what makes this press a step the run answered",
  );
  assertGreaterThan(
    after.sim?.cycle ?? -1,
    before.sim?.cycle ?? 0,
    "and it ran the machine to the next boundary, so the cycle counter has moved on",
  );
  assertLength(
    soundingFrames(heard, CUES.start),
    0,
    "no run started, so no frame sounds the start cue",
  );
});
