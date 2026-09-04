// audio/erase-cue-on-a-part-delete — removing the selected part sounds `erase`,
// once, on the frame the removal commits.
//
// THE RULE. `specs/ui.md` fixes the cue and its event: "| `erase` | `CUES.erase` |
// A part is removed. |", played "on the frame its event happens, from `update`,
// and at most once on that frame, however many of the event fired within it".
// What removes the part is `specs/editor.md`: "The field-focus actions of
// `specs/controls.md` act on the selected part: ... and `part-delete` removes any
// part."
//
// THE PRESS IS THE PLAYER'S. `part-delete` is fired through the key
// `specs/controls.md` binds to it, with the focus on the field and the arm
// selected, rather than through the surface's `removePart` — the item is about
// the editor's verb, and a pose "sounds nothing" at the call by
// `specs/instrumentation.md` in any case.
//
// WHICH FRAME THE REMOVAL COMMITS ON. `specs/instrumentation.md`'s clock switch
// "keeps rendering and keeps reading the keys" while the simulation is held, so a
// build that reads its keys in its own loop frame and one that reads them inside
// the frame the harness drives are both conformant, and the cue — "played on the
// frame its event happens, from `update`" — lands on the frame that ran the
// update which saw the press. This check therefore reads the press's frame and
// the one after it as the window the cue may land in, and requires exactly one
// frame in it to sound.
//
// THE CONFIGURATION. `BARE` in the editor with one arm on `ORIGIN`, placed and
// selected through the surface, which sounds nothing at the call. Nothing else is
// on the machine, so nothing else can be what sounded, and the removal is read
// back from the snapshot before the cue is judged.
//
// THE VERDICT. The frames before the press are silent — "on no frame before it".
// Exactly one frame of the press's window sounds, and no frame after it does,
// however many further frames run.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertLength } from "../assert";
import { CUES, RECORDING_RUN_UP, RECORDING_SETTLE } from "../constants";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureReplay,
  createHarness,
  openChallengeDocument,
  partIds,
  placePart,
  pressAction,
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
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds erase once, on the frame the part-delete press was answered on", async () => {
  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();
  const arm = await placePart(h, "arm", ORIGIN);
  await h.debug.setFocus("field");
  await h.debug.setSelected(arm);

  await openSilence(h);
  const heard = watchCues(h);
  await h.advance(FENCE_FRAMES);
  assertLength(
    soundingFrames(heard, CUES.erase),
    0,
    "the standing arm sounds nothing while it stands, so nothing sounds before the press",
  );

  // The recording brackets the press rather than the frame it is answered on: the
  // run-up is taken on the standing arm, which the fence above has just read as
  // silent, and the settle on the field it left. The frame the press was answered
  // on and the frames that sounded are read INSIDE, past the run-up and before the
  // settle, so the reading below is the reading the press itself produced.
  let pressed = 0;
  let sounded: number[] = [];
  await captureReplay(h, "erased", async () => {
    await h.advance(RECORDING_RUN_UP);
    await pressAction(h, "part-delete");
    await h.advance(PRESS_LAG);
    pressed = h.frame();
    sounded = soundingFrames(heard, CUES.erase);
    await h.advance(RECORDING_SETTLE);
  });

  assertLength(
    await partIds(h),
    0,
    "part-delete removed the selected part, which is the event the cue is for",
  );
  assertLength(
    sounded,
    1,
    "exactly one frame sounds the erase cue: a removal sounds it once",
  );
  assertBetween(
    sounded[0] ?? 0,
    pressed - PRESS_LAG,
    pressed,
    "and that frame is the one the press was answered on, whichever of the two frames a build reads its keys in",
  );

  await h.advance(TAIL_FRAMES);
  assertLength(
    soundingFrames(heard, CUES.erase),
    1,
    "no frame after the removal sounds it again",
  );
});
