// audio/start-run-pose-plays-no-cue — `startRun` runs the whole run-start
// sequence and sounds nothing.
//
// THE RULE. "Audio belongs to the frames. A pose changes the state alone and
// SOUNDS NOTHING, the pointer operations included; the cues a scenario hears come
// from the frames advanced after it" (`specs/instrumentation.md`, A render-free
// core). `startRun()` is a row of that surface's run group — "Runs the game's
// run-start sequence of `specs/simulation.md`: every arm and wheel at its rest
// pose holding nothing, every wheel's six fixtures placed, the settle, `sim.cycle`
// at `0` ... and `sim.status` `running`" — and it is a pose like every other one
// there. `CUES.start` is the cue of the player starting a run: "`start` |
// `CUES.start` | A run starts" (`specs/ui.md`), and the same file says outright
// which side `startRun` is on: "no other pose raises a cue at all, on that frame
// or any later one — a part the machine group places, moves, or removes is silent,
// AND SO IS A RUN `startRun` BEGINS". Its own row marks where the two part
// company: "The readiness condition the `play` action applies is not applied", so
// `startRun` is deliberately not the player's `play`.
//
// THE SILENCE IS READ TWICE, at the call and over the frames advanced afterwards,
// where a cue the pose had merely deferred would arrive. The machine is a rise, a
// set and one arm with an empty tape, so the run turns without carrying,
// delivering or faulting anything, and the frames read hold no other event to
// sound on. They stay inside the first cycle, so no boundary falls in the window
// either.
//
// AND THE READING IS SHOWN TO WORK. The run is stopped again and started the way
// a PLAYER starts one — `play`, which `specs/controls.md` binds to `Space` and
// `specs/editor.md` allows on this machine because every rise and every set is
// placed — and the count moves.
//
// THE VERDICT. `startRun` left a live, running run; nothing sounded at the call
// or on the frames after it; and `play`, over the same build, sounds.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNotNull } from "../assert";
import { BARE, IDLE_MACHINE } from "../fixtures";
import {
  captureReplay,
  createHarness,
  loadMachine,
  openChallengeDocument,
  openTitle,
  playAction,
  stopRun,
  watchCues,
  type Harness,
} from "../harness";
import { openSilence } from "./silence";

/**
 * Frames advanced after the pose, where a deferred cue would arrive. Fewer than
 * the frames one cycle is driven over, so no boundary falls inside the window.
 */
const AFTER = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("starts a run from code without sounding a start cue", async () => {
  await openTitle(h);
  await openSilence(h);

  await openChallengeDocument(h, BARE);
  await loadMachine(h, IDLE_MACHINE);
  await h.advance(2);
  assertEqual(
    (await h.snapshot()).sim,
    null,
    "no run is live before the pose, so the run below is the one it started",
  );

  const played = watchCues(h);
  const before = await h.sounds();

  const started = await captureReplay(h, "silent", async () => {
    await h.debug.startRun();
    const after = await h.snapshot();
    const reading = { sounded: await h.sounds(), stamped: played.length };

    // Only now, past the reading, are the frames run a deferred cue would land on.
    await h.advance(AFTER);
    return { after, reading };
  });

  assertNotNull(
    started.after.sim,
    "startRun left a live run, so the silence is a silence over a real run start",
  );
  assertEqual(
    started.after.sim?.status,
    "running",
    "with the status the run-start sequence sets",
  );
  assertEqual(
    started.reading.sounded,
    before,
    "startRun sounds nothing at the call: a pose changes the state alone",
  );
  assertEqual(
    started.reading.stamped,
    0,
    "and no cue was attributed to a frame, because no frame ran",
  );
  assertEqual(
    await h.sounds(),
    before,
    "and none arrived on the frames advanced afterwards either: no CUES.start is deferred out of a pose",
  );
  assertEqual(
    (await h.snapshot()).sim?.cycle,
    0,
    "the window stayed inside the first cycle, so no boundary could have sounded in it",
  );

  // The control: the same start made the player's way does sound.
  await stopRun(h);
  await playAction(h);
  await h.advance(2);
  assertEqual(
    (await h.snapshot()).sim?.status,
    "running",
    "play started the run on a machine with every rise and every set placed",
  );
  assertGreaterThan(
    await h.sounds(),
    before,
    "and the same build sounds for it, so the silence above is the pose's rather than a build that cannot be heard",
  );
});
