// audio/no-place-cue-on-a-move-released-where-it-began — a field drag let go on
// the hex it was pressed on moves nothing and sounds nothing.
//
// THE RULE. The cue's event is a part placed or moved: "| `place` | `CUES.place`
// | A part is placed or moved. |" (`specs/ui.md`). `specs/editor.md` says this
// gesture is neither: "From the field: a press on a part selects it at once and
// begins a move ... RELEASING ON THE STARTING HEX COMMITS NO MOVE; releasing
// elsewhere moves the part by the offset when the result is legal." With no move
// committed there is nothing for the cue to be played for.
//
// THE CONFIGURATION. `BARE` in the editor with one arm anchored on `ORIGIN`
// through the surface, which sounds nothing at the call, and one gesture: a press
// on `ORIGIN`, a move onto `ELSEWHERE` and back onto `ORIGIN` — so the drag is
// live and has really targeted another hex, which is what makes the release a
// release ON THE STARTING HEX rather than a press that never moved — and a
// release there.
//
// THE DRAG IS SHOWN TO HAVE BEEN LIVE. `editor.drag` is read while the pointer is
// out on `ELSEWHERE`, so a build that opens no move drag at all fails on that
// reading rather than passing this point by ignoring the field.
//
// THE VERDICT. The arm is still anchored on `ORIGIN` afterwards, and no frame
// from the watcher's opening to the end of the frames run after the release
// sounds anything.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { CUES } from "../constants";
import { at, hexCenter } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureReplay,
  createHarness,
  moveTo,
  openChallengeDocument,
  partById,
  placePart,
  pressAt,
  releasePointer,
  watchCues,
  type Harness,
} from "../harness";
import {
  FENCE_FRAMES,
  TAIL_FRAMES,
  openSilence,
  soundingFrames,
} from "./silence";

/** The hex the drag visits before coming back: empty, and one step north-east. */
const ELSEWHERE = at(1, -1);

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

it("sounds nothing when the release lands back on the hex the press grabbed", async () => {
  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();
  const arm = await placePart(h, "arm", ORIGIN);

  await openSilence(h);
  const heard = watchCues(h);
  await h.advance(FENCE_FRAMES);

  const away = await captureReplay(h, "silent", async () => {
    await pressAt(h, hexCenter(ORIGIN));
    await moveTo(h, hexCenter(ELSEWHERE));
    const targeting = (await h.snapshot()).editor.drag;
    await moveTo(h, hexCenter(ORIGIN));
    await releasePointer(h);
    await h.advance(TAIL_FRAMES);
    return targeting;
  });

  assertEqual(
    away?.kind === "move" ? `${away.at?.q},${away.at?.r}` : "no move drag",
    `${ELSEWHERE.q},${ELSEWHERE.r}`,
    "the press opened a live move drag, which really targeted another hex before coming back",
  );
  const standing = partById(await h.snapshot(), arm);
  assertEqual(
    standing === null ? "gone" : `${standing.q},${standing.r}`,
    `${ORIGIN.q},${ORIGIN.r}`,
    "the release on the starting hex commits no move, so the arm is on the anchor it began on",
  );
  assertLength(
    soundingFrames(heard, CUES.place),
    0,
    "no part was placed or moved, so no frame sounds the place cue",
  );
});
