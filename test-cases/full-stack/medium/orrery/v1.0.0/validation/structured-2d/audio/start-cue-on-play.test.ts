// audio/start-cue-on-play — `play` on a machine that is ready sounds `start`,
// once, on the frame the run starts.
//
// THE RULE. `specs/ui.md` fixes the cue and its event: "| `start` | `CUES.start` |
// A run starts. |", played "on the frame its event happens, from `update`, and at
// most once on that frame". What starts the run is `specs/editor.md`: "The `play`
// action starts a run when every rise and every set is placed."
//
// THE PRESS IS THE PLAYER'S. The run is started by pressing the key
// `specs/controls.md` binds to `play`, never through `startRun`, of which
// `specs/instrumentation.md` says "the readiness condition the `play` action
// applies is not applied" — and which, being a pose, "sounds nothing" at the call
// in any case.
//
// WHICH FRAME THE RUN STARTS ON. `specs/instrumentation.md`'s clock switch "keeps
// rendering and keeps reading the keys" while the simulation is held, so a build
// that reads its keys in its own loop frame and one that reads them inside the
// frame the harness drives are both conformant, and the cue — "played on the
// frame its event happens, from `update`" — lands on the frame that ran the
// update which saw the press. The window this check allows is that pair of
// frames, and exactly one frame in it must sound.
//
// THE CONFIGURATION. `BARE`, whose one reagent and one product are both a lone
// `sol`, with exactly the machine the readiness condition names: the rise for
// reagent `0` on `WEST`, the set for product `0` on `EAST`, and one arm at rest
// with an empty tape between them, so the run that starts faults at nothing and
// delivers nothing. `sim` is read as `null` before the press, so the run the
// check hears is a run the press started.
//
// THE VERDICT. The frames before the press are silent — "on no frame before it".
// Exactly one frame of the press's window sounds, the run is live and `running`
// afterwards, and no further frame sounds it again.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertBetween,
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { CUES } from "../constants";
import { armPart, risePart, setPart, solution } from "../formats";
import { BARE, EAST, ORIGIN, WEST } from "../fixtures";
import {
  captureReplay,
  createHarness,
  loadMachine,
  openChallengeDocument,
  playAction,
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

/** The rise for reagent `0`, the set for product `0`, and one idle arm between. */
const READY_MACHINE = solution([
  risePart(0, WEST.q, WEST.r),
  setPart(0, EAST.q, EAST.r),
  armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, []),
]);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds start once, on the frame the play press started the run on", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(h, READY_MACHINE);
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

  await captureReplay(h, "started", async () => {
    await playAction(h);
    await h.advance(PRESS_LAG);
  });
  const pressed = h.frame();

  const started = await h.snapshot();
  assertNotNull(
    started.sim,
    "play starts a run when every rise and every set is placed, which is the event the cue is for",
  );
  assertEqual(
    started.sim?.status,
    "running",
    "play produces the running status, where step would have left the run paused",
  );
  const sounded = soundingFrames(heard, CUES.start);
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
    "a run that has started does not start again: no later frame sounds it",
  );
});
