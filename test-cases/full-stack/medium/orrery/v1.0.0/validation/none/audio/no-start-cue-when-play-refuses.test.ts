// audio/no-start-cue-when-play-refuses — `play` that starts no run sounds
// nothing.
//
// THE RULE. `specs/ui.md` gives the cue an event rather than a key: "| `start` |
// `CUES.start` | A run starts. |" `specs/editor.md` says when the press raises no
// such event: "The `play` action starts a run when every rise and every set is
// placed; OTHERWISE IT DOES NOTHING and the heading states which are missing."
// With no run started there is nothing for the cue to be played for.
//
// THE CONFIGURATION. `TWO_AND_TWO`, whose two reagents and two products give the
// challenge TWO rises and TWO sets, so the readiness condition is posed on ANY
// rise rather than on the only one: both sets are placed, the rise for reagent
// `0` is placed, the rise for reagent `1` is left in the tray, and one arm stands
// between them. The machine is loaded as a document through the surface, which
// sounds nothing at the call.
//
// THE PRESS IS THE PLAYER'S, through the key `specs/controls.md` binds to `play`
// — the readiness condition is exactly what `startRun` does not apply.
//
// THE REFUSAL IS READ, NOT ASSUMED. `sim` is `null` before the press and `null`
// after it, so what the silence belongs to is a press that started nothing rather
// than a press that never arrived.
//
// THE VERDICT. No frame from the watcher's opening to the end of the frames run
// after the press sounds anything.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertNull } from "../assert";
import { CUES } from "../constants";
import { armPart, risePart, setPart, solution } from "../formats";
import { ORIGIN, TWO_AND_TWO } from "../fixtures";
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
  TAIL_FRAMES,
  openSilence,
  soundingFrames,
} from "./silence";

/** Both sets, the rise for reagent `0`, and one arm: reagent `1`'s rise is missing. */
const MISSING_A_RISE = solution([
  risePart(0, -3, 0),
  setPart(0, 3, 0),
  setPart(1, 3, -3),
  armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, []),
]);

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

it("sounds nothing when the press starts no run", async () => {
  await openChallengeDocument(h, TWO_AND_TWO);
  await loadMachine(h, MISSING_A_RISE);
  await openSilence(h);

  const heard = watchCues(h);
  await h.advance(FENCE_FRAMES);
  assertNull(
    (await h.snapshot()).sim,
    "no run is live before the press, so the press is what would have started one",
  );

  await captureReplay(h, "silent", async () => {
    await playAction(h);
    await h.advance(TAIL_FRAMES);
  });

  assertNull(
    (await h.snapshot()).sim,
    "play does nothing while one of the challenge's rises is unplaced, so sim stays null",
  );
  assertLength(
    soundingFrames(heard, CUES.start),
    0,
    "no run started, so no frame sounds the start cue",
  );
});
