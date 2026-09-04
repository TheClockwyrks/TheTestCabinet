// audio/erase-cue-alone-on-a-removal — the frame a part is removed on sounds one
// cue, not two: a removal is not also a placement.
//
// THE RULE. `specs/ui.md` gives the two cues separate events: "| `place` |
// `CUES.place` | A part is placed or moved. | `erase` | `CUES.erase` | A part is
// removed. |" A removal is the second event and not the first, and each cue is
// played "on the frame its event happens" — so the frame a part is removed on has
// had one of the two events and sounds one cue.
//
// HOW ONE CUE IS TOLD FROM TWO, ON ALL THREE ENGINES. Under either engine the cue
// bus announces a name; under no engine there is no bus and a check can hear only
// that a frame sounded and how much (`scenario.ts`, `cuesOf`). So this check
// reads what every engine can read: the SIZE of the frame's sound beside the size
// of a frame that is known to have sounded exactly one cue. The known frame is
// this scenario's own placement — one arm dragged out of the tray, which sounds
// `place` alone — and the frame under test is the removal of that same arm. A
// build that sounded `erase` and `place` together on the removal frame sounds
// more there than it did on the placement; a build that sounds one cue sounds the
// same.
//
// THE CONFIGURATION. `BARE` in the editor on the empty machine `loadChallenge`
// leaves. One arm is taken out of tray entry `0` and dropped on `ORIGIN` — the
// placement, and the reference frame — and then selected and deleted with
// `part-delete`, the editor's own verb. Nothing else is on the machine at any
// point, so the two frames read are the two events.
//
// THE VERDICT. Exactly one frame sounds for the placement and exactly one for the
// removal, and the removal's frame carries no more sound than the placement's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import { CUES } from "../constants";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureReplay,
  createHarness,
  dragFromTray,
  partIds,
  openChallengeDocument,
  pressAction,
  watchCues,
  type Harness,
} from "../harness";
import {
  FENCE_FRAMES,
  TAIL_FRAMES,
  openSilence,
  soundingFrames,
  soundsOnFrame,
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

it("sounds no more on the frame that removed the part than on the frame that placed it", async () => {
  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();
  await openSilence(h);

  const placing = watchCues(h);
  await h.advance(FENCE_FRAMES);
  await dragFromTray(h, ARM_SLOT, ORIGIN);
  await h.advance(1);
  const placed = await partIds(h);
  assertLength(placed, 1, "the tray drag placed one arm");
  const placeFrames = soundingFrames(placing, CUES.place);
  assertLength(
    placeFrames,
    1,
    "the placement sounds on exactly one frame, which is this check's measure of one cue",
  );
  const oneCue = soundsOnFrame(placing, placeFrames[0] ?? 0);
  assertGreaterThan(
    oneCue,
    0,
    "and that frame really sounded, so the measure is a sound rather than a silence",
  );

  await h.debug.setFocus("field");
  await h.debug.setSelected(placed[0] ?? -1);
  await openSilence(h);

  const erasing = watchCues(h);
  await h.advance(FENCE_FRAMES);
  await captureReplay(h, "erased", async () => {
    await pressAction(h, "part-delete");
    await h.advance(TAIL_FRAMES);
  });

  assertLength(
    await partIds(h),
    0,
    "part-delete removed the arm, so the frame read below is a removal's frame",
  );
  const eraseFrames = soundingFrames(erasing, CUES.erase);
  assertLength(eraseFrames, 1, "the removal sounds on exactly one frame");
  assertEqual(
    soundsOnFrame(erasing, eraseFrames[0] ?? 0),
    oneCue,
    "and that frame carries one cue's worth of sound, not two: a removal sounds erase alone",
  );
});
