// audio/cue-drop — a drop a pile accepts plays the drop cue.
//
// specs/audio.md fixes `CUES.drop` (`"drop"`) as the cue played when "a drop is
// accepted by the pile it resolved to", and governs all ten with one sentence:
// "Each is played on the frame its event happens and at most once on that frame."
//
// So the measurement is: pose a run and a column that accepts it, run a quiet lead,
// press the run on one frame, carry it to the accepting column and release it on
// the NEXT frame, and read what sounded on the release's frame against what sounded
// on every frame before it — the quiet lead and the press frame included.
//
// THE GESTURE IS SPLIT ACROSS TWO FRAMES ON PURPOSE. A press and a release
// delivered inside one frame both take effect on that frame (specs/controls.md), so
// the `lift` the press raises and the `drop` the release raises would land on the
// same frame and a build that sounded `drop` on the PRESS would be indistinguishable
// from a conforming one. Pressing on its own frame puts the press inside this
// point's "and not before" window, which is what separates them.
//
// THE DROP IS RELEASED, NOT POSED. The surface's pointer operations are poses, and
// a pose runs between frames with no route to the engine's audio bus
// (`harness.ts`), so a posed release would never raise this cue. The gesture read
// here goes through the engine's own pointer and is answered by a frame's update.
//
// THE TARGET ACCEPTS. specs/tableau.md has a column whose lowest card is the black
// six accept a run led by a red five, so the release below resolves to a pile that
// takes it and the drop is an ACCEPTED one; `audio/cue-reject` poses the refusing
// case and reads the other cue. The two cards are the whole table, so nothing else
// can raise a cue of any name, and the column the run leaves is emptied rather than
// exposing a face-down card, so no `flip` is raised either.
//
// WHAT THIS DOES NOT DECIDE. Which pile a release resolves to, and what a column
// accepts, are the `handling` and `tableau` groups' requirements. This point reads
// the cue alone, and asks of the drop only that the run landed on the target.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { CUES, DOUBLE_CLICK_WINDOW } from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  openTable,
  placeOf,
  poseColumn,
  pressPoint,
  releasePoint,
  watchCues,
  type Harness,
} from "../harness";
import {
  playedAfter,
  playedBefore,
  playedOn,
  pressFrame,
  releaseFrame,
} from "./cues";

/**
 * Frames of silence driven on the posed table, on each side of the gesture.
 *
 * A whole `DOUBLE_CLICK_WINDOW` (`0.30` s, specs/controls.md), which is the longest
 * span this case fixes anywhere — the launch interval, the only other duration in
 * the case, is `0.18` s (specs/victory.md). So a build that sounds a cue on any
 * period the case names has to cross a window longer than its own period without
 * sounding anything. It is also longer than the double-click window itself, so the
 * press below is measured against no press before it.
 *
 * The SAME window is driven again AFTER the event, and the cue read across it too.
 * A cue belongs to the ONE frame its event happened on (specs/audio.md), so a check
 * that read only the frames before and the event's own frame would pass a build that
 * echoed the cue on the frame after it, or that started it repeating. Reading quiet
 * on both sides closes that.
 */
const QUIET_WINDOW = framesFor(DOUBLE_CLICK_WINDOW);

/**
 * The run that is carried, and the column that takes it.
 *
 * A red five onto a black six: one rank lower and the opposite color, which is what
 * specs/tableau.md has a column accept.
 */
const RUN = "5H";
const FROM_COLUMN = 0;
const FROM_ROW = 0;
const TARGET = "6S";
const TO_COLUMN = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.drop on the frame a release is accepted by its target, and on no frame either side", async () => {
  const cues = watchCues(h);
  openTable(h);
  const [run] = poseColumn(h, FROM_COLUMN, [RUN]);
  poseColumn(h, TO_COLUMN, [TARGET]);
  await h.advance(QUIET_WINDOW);

  await pressFrame(
    h,
    pressPoint(h.snapshot(), "tableau", FROM_COLUMN, FROM_ROW),
  );
  const at = await releaseFrame(
    h,
    releasePoint(h.snapshot(), "tableau", TO_COLUMN),
  );
  captureStill(h, "drop");

  const landed = placeOf(h.snapshot(), run);
  assertDeepEqual(
    landed === null ? null : { pile: landed.pile, index: landed.index },
    { pile: "tableau", index: TO_COLUMN },
    `the pile holding the ${RUN} after it was released over the ${TARGET}, ` +
      "which is the accepted drop whose cue this point reads " +
      "(specs/controls.md, specs/tableau.md)",
  );
  assertEqual(
    playedBefore(cues, at, CUES.drop),
    0,
    `times CUES.drop played over the ${String(QUIET_WINDOW)} quiet frames and ` +
      "the press frame before the release (specs/audio.md: a cue is played on " +
      "the frame its event happens)",
  );
  assertEqual(
    playedOn(cues, at, CUES.drop),
    1,
    "times CUES.drop played on the frame the target accepted the release, " +
      "which is its own frame and at most once on it (specs/audio.md)",
  );

  await h.advance(QUIET_WINDOW);
  assertEqual(
    playedAfter(cues, at, CUES.drop),
    0,
    `times CUES.drop played over the ${String(QUIET_WINDOW)} frames after the ` +
      "release, with nothing in hand and nothing left to accept " +
      "(specs/audio.md: a cue is played on the frame its event happens)",
  );
});
