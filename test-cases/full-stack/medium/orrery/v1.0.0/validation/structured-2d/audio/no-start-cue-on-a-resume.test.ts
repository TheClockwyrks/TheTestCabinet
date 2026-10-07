// audio/no-start-cue-on-a-resume — `play` on a paused run resumes it and sounds
// nothing: a resume is not a start.
//
// THE RULE. `specs/ui.md` gives the cue one event: "| `start` | `CUES.start` | A
// run starts. |" `specs/editor.md` separates the two things `play` does: "The
// `play` action starts a run when every rise and every set is placed ... After
// that ... While the status is `running` or `paused`, `play` TOGGLES BETWEEN THE
// TWO." A toggle from `paused` back to `running` starts no run —
// `specs/simulation.md`'s run-start sequence, which poses every part at rest,
// raises the fixtures, runs the settle and zeroes the counters, does not happen —
// so the cue's event has not occurred.
//
// THE CONFIGURATION. `BARE` opened as a bare run — a posed challenge, an empty
// machine, the completion switch held off, a live run and an empty field — and
// then PAUSED THROUGH THE SURFACE, which "moves `sim.status` between `running`
// and `paused`, exactly as the `play` toggle moves it" and sounds nothing at the
// call. So the only press in the whole scenario is the one under test, and
// whatever the run's start sounded is long past the watcher's opening. The field
// is empty and the machine holds nothing, so no boundary can deliver, fault or
// complete while the check listens.
//
// THE RESUME IS READ, NOT ASSUMED. The status is `paused` before the press and
// `running` after it, so the silence belongs to a press that really moved the run
// rather than to a press the build ignored.
//
// THE VERDICT. No frame from the watcher's opening to the end of the frames run
// after the press sounds anything.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { CUES } from "../constants";
import { BARE } from "../fixtures";
import {
  captureReplay,
  createHarness,
  openBareRun,
  pauseRun,
  playAction,
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

it("sounds nothing when play moves the run from paused back to running", async () => {
  await openBareRun(h, { challenge: BARE });
  await pauseRun(h);
  await openSilence(h);

  const heard = watchCues(h);
  await h.advance(FENCE_FRAMES);
  assertEqual(
    (await h.snapshot()).sim?.status,
    "paused",
    "the run is live and paused before the press, so the press is a resume",
  );

  await captureReplay(h, "silent", async () => {
    await playAction(h);
    await h.advance(TAIL_FRAMES);
  });

  assertEqual(
    (await h.snapshot()).sim?.status,
    "running",
    "the press moved the status from paused to running, which is the toggle rather than a start",
  );
  assertLength(
    soundingFrames(heard, CUES.start),
    0,
    "no run started, so no frame sounds the start cue",
  );
});
