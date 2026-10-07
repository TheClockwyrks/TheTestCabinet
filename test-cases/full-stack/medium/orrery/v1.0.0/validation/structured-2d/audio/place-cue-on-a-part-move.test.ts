// audio/place-cue-on-a-part-move — moving a part already on the field sounds
// `place`, once, on the frame the move commits.
//
// THE RULE. The cue's event covers both halves of the drag: "| `place` |
// `CUES.place` | A part is placed OR MOVED. |" (`specs/ui.md`), sounded "on the
// frame its event happens, from `update`, and at most once on that frame". What
// commits a move is `specs/editor.md`, Dragging: "From the field: a press on a
// part selects it at once and begins a move. The drag's offset is the targeted
// hex minus the pressed hex, and the whole part translates by it ... releasing
// elsewhere moves the part by the offset when the result is legal."
//
// WHICH FRAME THE MOVE COMMITS ON. The gesture is made through the surface's
// pointer operations, which take effect at the call rather than on a frame, and
// `specs/ui.md` places the cue of such an edit exactly: "an event raised outside
// one — an edit a pointer pose of `specs/instrumentation.md` commits between
// frames — sounds on the next frame advanced rather than at the call." So the
// frame the move commits on is the one frame advanced after the release.
//
// THE CONFIGURATION. `BARE` in the editor with ONE arm, anchored on `ORIGIN`
// through the surface — which "pushes no undo entry" and sounds nothing, so the
// standing arm is simply where the scenario needs it and the window opens quiet.
// The gesture presses `ORIGIN` and releases on `MOVED_TO`, one hex north-east: an
// offset that breaks no rule of `specs/parts.md`, since the hex is on the field
// and the machine holds nothing else at all. The move is READ BACK from the
// snapshot before the cue is judged, so a build that sounded the cue while
// refusing the move fails on the move.
//
// THE VERDICT. Every frame from the watcher's opening to the release is silent.
// The one frame advanced after the release sounds, and no frame after it does.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { CUES, RECORDING_RUN_UP, RECORDING_SETTLE } from "../constants";
import { at } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureReplay,
  createHarness,
  dragHex,
  openChallengeDocument,
  partById,
  placePart,
  watchCues,
  type Harness,
} from "../harness";
import {
  FENCE_FRAMES,
  TAIL_FRAMES,
  openSilence,
  soundingFrames,
} from "./silence";

/** Where the arm is dragged to: one hex north-east of the origin, and empty. */
const MOVED_TO = at(1, -1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds place once, on the frame after the release that moved the part", async () => {
  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();
  const arm = await placePart(h, "arm", ORIGIN);
  await openSilence(h);

  const heard = watchCues(h);
  await h.advance(FENCE_FRAMES);
  assertLength(
    soundingFrames(heard, CUES.place),
    0,
    "the standing arm sounds nothing while it stands: a pose sounds nothing at the call",
  );

  // The recording brackets the gesture rather than the frame it lands on: the
  // run-up is taken on the standing arm, which the fence above has just read as
  // silent, and the settle on the moved one. The frame the release is counted from
  // is taken INSIDE, past the run-up, and the sounds are read there too, so the
  // reading below is the reading the release itself produced.
  let released = 0;
  let atRelease: number[] = [];
  await captureReplay(h, "moved", async () => {
    await h.advance(RECORDING_RUN_UP);
    released = h.frame();
    await dragHex(h, ORIGIN, MOVED_TO);
    await h.advance(1);
    atRelease = soundingFrames(heard, CUES.place);
    await h.advance(RECORDING_SETTLE);
  });

  const moved = partById(await h.snapshot(), arm);
  assertEqual(
    moved === null ? "gone" : `${moved.q},${moved.r}`,
    `${MOVED_TO.q},${MOVED_TO.r}`,
    "the release on a legal hex moved the part by the drag's offset, which is the event the cue is for",
  );
  assertDeepEqual(
    atRelease,
    [released + 1],
    "the place cue sounds on the one frame advanced after the release, and on no frame before it",
  );

  await h.advance(TAIL_FRAMES);
  assertDeepEqual(
    soundingFrames(heard, CUES.place),
    [released + 1],
    "and on no frame after it either: a move sounds place exactly once",
  );
});
