// audio/erase-cue-once-for-a-whole-track — deleting a track of many cells sounds
// `erase` once, not once per cell.
//
// THE RULE. `specs/ui.md`: "| `erase` | `CUES.erase` | A part is removed. |",
// played "on the frame its event happens, from `update`, and AT MOST ONCE ON THAT
// FRAME, HOWEVER MANY OF THE EVENT FIRED WITHIN IT". A track is one part however
// long its path is — `specs/editor.md`: "Deleting a track deletes its whole path"
// — so the removal is one event, and even a build that counted it as one per cell
// may sound the cue only once on the frame.
//
// HOW ONE CUE IS TOLD FROM FOUR, ON ALL THREE ENGINES. Under either engine the
// cue bus announces a name; under no engine a check can hear only that a frame
// sounded and how much (`scenario.ts`, `cuesOf`). So the reading is a COMPARISON
// between two removals in the same scenario, on the same build, of the same cue:
// a one-cell track and a four-cell track. A build that sounds once per part
// sounds the same on both frames; a build that sounds once per cell sounds four
// times as much on the second. Neither figure is compared against a literal,
// because what one cue costs a build in sound sources is the build's business.
//
// THE CONFIGURATION. `BARE` in the editor with two open tracks placed through the
// surface — one cell on `SINGLE`, and four consecutive cells running east from
// `PATH` — which are legal together because "Two tracks never share a hex" is the
// only rule they could break and they are three rows apart. Each is selected and
// deleted with `part-delete`, the editor's own verb, one after the other.
//
// THE VERDICT. Each removal sounds on exactly one frame; the four-cell track's
// frame carries exactly what the one-cell track's frame carried; and the machine
// is empty afterwards, so the four-cell path really went as one part.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import { CUES } from "../constants";
import { at } from "../field";
import { BARE } from "../fixtures";
import {
  captureReplay,
  createHarness,
  openChallengeDocument,
  partIds,
  placeTrack,
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

/** The one-cell track: the removal that is one part and one cell at once. */
const SINGLE = at(-2, 2);

/** The four-cell track, running east from here. */
const PATH = [at(0, 0), at(1, 0), at(2, 0), at(3, 0)] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds the same for a four-cell path as for a one-cell one", async () => {
  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();
  const single = await placeTrack(h, [SINGLE]);
  const path = await placeTrack(h, [...PATH]);
  assertLength(await partIds(h), 2, "the two tracks stand on the machine");

  await h.debug.setFocus("field");
  await h.debug.setSelected(single);
  await openSilence(h);

  const first = watchCues(h);
  await h.advance(FENCE_FRAMES);
  await pressAction(h, "part-delete");
  await h.advance(TAIL_FRAMES);
  const oneCellFrames = soundingFrames(first, CUES.erase);
  assertLength(
    oneCellFrames,
    1,
    "removing the one-cell track sounds on exactly one frame, which is this check's measure of one cue",
  );
  const oneCue = soundsOnFrame(first, oneCellFrames[0] ?? 0);
  assertGreaterThan(
    oneCue,
    0,
    "and that frame really sounded, so the measure is a sound rather than a silence",
  );

  await h.debug.setSelected(path);
  await openSilence(h);

  const second = watchCues(h);
  await h.advance(FENCE_FRAMES);
  await captureReplay(h, "track", async () => {
    await pressAction(h, "part-delete");
    await h.advance(TAIL_FRAMES);
  });

  assertLength(
    await partIds(h),
    0,
    "the four-cell path went as one part, so the machine is empty",
  );
  const fourCellFrames = soundingFrames(second, CUES.erase);
  assertLength(
    fourCellFrames,
    1,
    "removing the four-cell track sounds on exactly one frame, not on one frame per cell",
  );
  assertEqual(
    soundsOnFrame(second, fourCellFrames[0] ?? 0),
    oneCue,
    "and that frame carries exactly what a one-cell removal carried: one erase for the whole path",
  );
});
