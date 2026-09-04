// audio/start-cue-on-step-starting-a-run — `step` from the editor starts a run
// too, and sounds `start` once, exactly as `play` does.
//
// THE RULE. `specs/ui.md` ties the cue to the event rather than to the action:
// "| `start` | `CUES.start` | A run starts. |", played "on the frame its event
// happens, from `update`, and at most once on that frame". `specs/editor.md`
// gives `step` the same power to raise that event: "The `play` action starts a
// run when every rise and every set is placed ... `step` UNDER THE SAME CONDITION
// STARTS THE RUN PAUSED AT ITS SETTLE." A run started paused is a run started.
//
// THE PRESS IS THE PLAYER'S, through the key `specs/controls.md` binds to `step`.
// The surface's `startRun` is not used: it skips the readiness condition, and a
// pose "sounds nothing" at the call.
//
// WHICH FRAME THE RUN STARTS ON. `specs/instrumentation.md`'s clock switch "keeps
// rendering and keeps reading the keys" while the simulation is held, so the
// update that saw the press is either the frame the harness drove for it or the
// build's own next one; the cue lands on whichever ran the update. The window is
// that pair of frames, and exactly one frame in it must sound.
//
// THE CONFIGURATION. `BARE`, whose one reagent and one product are both a lone
// `sol`, with the machine the readiness condition asks for: its one rise on
// `WEST` and its one set on `EAST`, placed through the surface. No arm is placed,
// so nothing the settle raises can be carried or delivered. `sim` reads `null`
// before the press.
//
// THE VERDICT. The frames before the press are silent. Exactly one frame of the
// press's window sounds. The run is live and `paused` at cycle `0` afterwards —
// which is what makes this `step`'s start rather than `play`'s — and no further
// frame sounds it again.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertBetween,
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { CUES, RECORDING_RUN_UP, RECORDING_SETTLE } from "../constants";
import { BARE, EAST, WEST } from "../fixtures";
import {
  captureReplay,
  createHarness,
  openChallengeDocument,
  placeRise,
  placeSet,
  stepAction,
  watchCues,
  type Harness,
} from "../harness";
import {
  FENCE_FRAMES,
  PRESS_LAG,
  TAIL_FRAMES,
  openSilence,
  soundingFrames,
} from "./silence";

let h: Harness;

beforeEach(async () => {
  // ARMED AT CREATION, because this suite reads what the build SOUNDED and a
  // browser opens no audio context without a user gesture: unarmed, `openSilence`
  // below would find the page's silence rather than the build's. The press of
  // `INERT_KEY` goes in before the harness's opening `reset`, whose restore puts
  // back anything it touched, so it costs this check nothing — see `silence.ts`.
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("sounds start once when step is what starts the run", async () => {
  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();
  await placeRise(h, 0, WEST);
  await placeSet(h, 0, EAST);
  await openSilence(h);

  const heard = watchCues(h);
  await h.advance(FENCE_FRAMES);
  assertNull(
    (await h.snapshot()).sim,
    "no run is live before the press, so the press is what starts one",
  );
  assertLength(
    soundingFrames(heard, CUES.start),
    0,
    "and nothing sounds while the machine merely stands ready",
  );

  // The recording brackets the press rather than the frame it is answered on: the
  // run-up is taken on the machine standing ready, which the fence above has just
  // read as silent, and the settle on the run it started, held at its settle. The
  // frame the press was answered on and the frames that sounded are read INSIDE,
  // past the run-up and before the settle, so the reading below is the press's own.
  let pressed = 0;
  let sounded: number[] = [];
  await captureReplay(h, "stepped", async () => {
    await h.advance(RECORDING_RUN_UP);
    await stepAction(h);
    await h.advance(PRESS_LAG);
    pressed = h.frame();
    sounded = soundingFrames(heard, CUES.start);
    await h.advance(RECORDING_SETTLE);
  });

  const started = await h.snapshot();
  assertNotNull(
    started.sim,
    "step on a machine with every rise and every set placed starts a run",
  );
  assertEqual(
    started.sim?.status,
    "paused",
    "step starts the run PAUSED at its settle, which is still a run starting",
  );
  assertEqual(
    started.sim?.cycle,
    0,
    "the cycle counter starts at 0: the settle is not a cycle",
  );
  assertLength(sounded, 1, "exactly one frame sounds the start cue");
  assertBetween(
    sounded[0] ?? 0,
    pressed - PRESS_LAG,
    pressed,
    "and that frame is the one the press was answered on, whichever of the two frames a build reads its keys in",
  );

  await h.advance(TAIL_FRAMES);
  assertLength(
    soundingFrames(heard, CUES.start),
    1,
    "the paused run does not start again: no later frame sounds it",
  );
});
