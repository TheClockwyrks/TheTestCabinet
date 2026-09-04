// audio/place-cue-on-a-tray-placement — taking a part out of the tray and
// dropping it on a legal hex sounds `place`, once, on the frame the placement
// commits.
//
// THE RULE. `specs/ui.md` fixes the cue and its event: "| `place` | `CUES.place` |
// A part is placed or moved. |", and fixes how often and when it may sound: "Each
// is a distinct short sound, played on the frame its event happens, from
// `update`, and at most once on that frame, however many of the event fired
// within it." What places the part is `specs/editor.md`, Dragging: "From the
// tray: the ghost is a new part at the targeted hex, at rotation `0` and length
// `1`. Releasing on a legal hex places it and selects it."
//
// WHICH FRAME THE PLACEMENT COMMITS ON. The gesture is made through the surface's
// three pointer operations, which "take effect immediately, when [they are]
// called, rather than being sampled once per frame" — so the placement commits
// between frames, and `specs/ui.md` says exactly where its cue lands: "Every cue
// is played from a frame, so an event raised outside one — an edit a pointer pose
// of `specs/instrumentation.md` commits between frames — sounds on the next frame
// advanced rather than at the call." The frame the placement commits on is
// therefore the ONE frame advanced after the release, and this check drives
// exactly one.
//
// THE CONFIGURATION. `BARE` opened in the editor on the empty machine
// `loadChallenge` leaves, and one gesture: a press in the middle of tray entry
// `0` — which is `arm`, the challenge's one permitted kind — a move onto `ORIGIN`,
// and a release there. Nothing else is on the machine, so nothing else can be
// what sounded.
//
// THE VERDICT. The frames from the watcher's opening to the release are silent,
// which is "on no frame before it". The one frame advanced after the release
// sounds, and it is the only frame that ever does, however many further frames
// run — which is "exactly once".

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength, assertNotNull } from "../assert";
import { CUES } from "../constants";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureReplay,
  createHarness,
  dragFromTray,
  openChallengeDocument,
  partById,
  partIds,
  watchCues,
  type Harness,
} from "../harness";
import {
  FENCE_FRAMES,
  TAIL_FRAMES,
  openSilence,
  soundingFrames,
} from "./silence";

/** `BARE`'s tray: `arm`, then the one rise, then the one set. */
const ARM_SLOT = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds place once, on the frame after the release that placed the part", async () => {
  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();
  await openSilence(h);

  const heard = watchCues(h);
  await h.advance(FENCE_FRAMES);
  assertLength(
    soundingFrames(heard, CUES.place),
    0,
    "nothing sounds while the machine is empty and the pointer has not moved",
  );

  const released = h.frame();
  const placed = await captureReplay(h, "placed", async () => {
    await dragFromTray(h, ARM_SLOT, ORIGIN);
    await h.advance(1);
    return partIds(h);
  });

  assertLength(
    placed,
    1,
    "the release on a legal hex placed the part, which is the event the cue is for",
  );
  assertNotNull(
    partById(await h.snapshot(), placed[0] ?? -1),
    "the placed arm is on the machine after the gesture",
  );
  assertDeepEqual(
    soundingFrames(heard, CUES.place),
    [released + 1],
    "the place cue sounds on the one frame advanced after the release, and on no frame before it",
  );

  await h.advance(TAIL_FRAMES);
  assertDeepEqual(
    soundingFrames(heard, CUES.place),
    [released + 1],
    "and on no frame after it either: a placement sounds place exactly once",
  );
});
