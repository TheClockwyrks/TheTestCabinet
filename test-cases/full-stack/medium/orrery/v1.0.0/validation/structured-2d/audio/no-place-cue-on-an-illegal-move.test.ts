// audio/no-place-cue-on-an-illegal-move — a move the placement rules refuse
// leaves the part where it was and sounds nothing.
//
// THE RULE. The cue's event is a part placed or moved: "| `place` | `CUES.place`
// | A part is placed or moved. |" (`specs/ui.md`). `specs/editor.md` says a
// refused move is not one: "releasing elsewhere moves the part by the offset WHEN
// THE RESULT IS LEGAL, AND LEAVES IT IN PLACE WHEN IT IS NOT". "Legal" is
// `specs/parts.md`'s placement rules, which the same file defers to: "a ghost of
// the part is drawn at the targeted hex, visibly legal or illegal under the
// placement rules".
//
// THE CONFIGURATION. `BARE` in the editor with TWO arms, on `WEST` and on
// `ORIGIN`, both placed through the surface, which sounds nothing at the call.
// The gesture presses `ORIGIN` and releases on `WEST`: an offset that would put
// two arms on one anchor, breaking placement rule 4 — "No two arms or wheels
// share an anchor hex" — and only that rule, since both hexes are on the field
// and no footprint, track, rise or set is anywhere near them. The placement
// oracle names rule 4 before the gesture, so what refuses the move is
// `specs/parts.md` rather than the build's opinion.
//
// THE VERDICT. The dragged arm is still anchored on `ORIGIN` and the arm on
// `WEST` is where it was, so nothing was placed and nothing was moved — and no
// frame from the watcher's opening to the end of the frames run after the release
// sounds anything.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { CUES } from "../constants";
import { armPart } from "../formats";
import { BARE, ORIGIN, WEST } from "../fixtures";
import { placementFault } from "../parts";
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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds nothing when the translated part would be illegal", async () => {
  const onWest = armPart("arm", WEST.q, WEST.r, 0, 1, []);
  assertEqual(
    placementFault([onWest, onWest], {
      reagents: BARE.reagents,
      products: BARE.products,
    })?.rule,
    4,
    "two arms on WEST's anchor break placement rule 4 and nothing else",
  );

  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();
  const resting = await placePart(h, "arm", WEST);
  const dragged = await placePart(h, "arm", ORIGIN);

  await openSilence(h);
  const heard = watchCues(h);
  await h.advance(FENCE_FRAMES);

  await captureReplay(h, "silent", async () => {
    await dragHex(h, ORIGIN, WEST);
    await h.advance(TAIL_FRAMES);
  });

  const after = await h.snapshot();
  const moved = partById(after, dragged);
  const stayed = partById(after, resting);
  assertEqual(
    moved === null ? "gone" : `${moved.q},${moved.r}`,
    `${ORIGIN.q},${ORIGIN.r}`,
    "the refused move leaves the dragged arm on the anchor it stood on",
  );
  assertEqual(
    stayed === null ? "gone" : `${stayed.q},${stayed.r}`,
    `${WEST.q},${WEST.r}`,
    "and an edit changes the edited part alone, so the other arm is where it was",
  );
  assertLength(
    soundingFrames(heard, CUES.place),
    0,
    "no part was placed or moved, so no frame sounds the place cue",
  );
});
