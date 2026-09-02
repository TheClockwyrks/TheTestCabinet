// audio/cue-lift — a press that lifts a run plays the lift cue.
//
// specs/audio.md fixes `CUES.lift` (`"lift"`) as the cue played when "a press lifts
// a run into the hand", and governs all ten with one sentence: "Each is played on
// the frame its event happens and at most once on that frame."
//
// So the measurement is: pose one face-up card in one column on an otherwise empty
// table, run a quiet lead during which nothing happens, then press that card
// through the engine's own pointer and read what sounded on the one frame that
// carried the press against what sounded on the frames before it.
//
// THE PRESS IS THE WHOLE GESTURE. specs/controls.md has the run enter the hand "on
// the press itself, before the pointer has moved at all", so the event this cue
// belongs to is complete when the press has been answered: the frame is driven with
// the button still down and nothing is released. That is what keeps this point
// separate from `audio/cue-drop` and `audio/cue-reject`, which read the cue a
// RELEASE raises.
//
// THE RUN IS LIFTED, NOT POSED. The surface's `pointerDown` is a pose, and a pose
// runs between frames with no route to the engine's audio bus (`harness.ts`), so it
// would never raise this cue. The press read here is dispatched through the
// engine's own pointer and answered by a frame's update, which is the path a
// player's press takes.
//
// ONE CARD IS THE WHOLE WORLD. A single face-up card in column 0 is the smallest
// board a run can be lifted from: nothing else is on the table to raise a cue of
// any name, and the run the press lifts is that one card (specs/controls.md).
//
// WHAT THIS DOES NOT DECIDE. Which cards a press picks up, and where the held run
// is drawn, are the `handling` group's requirements. This point reads the cue
// alone, and asks of the press only that something entered the hand.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { CUES, DOUBLE_CLICK_WINDOW } from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  openTable,
  poseColumn,
  pressPoint,
  watchCues,
  type Harness,
} from "../harness";
import { playedAfter, playedBefore, playedOn, pressFrame } from "./cues";

/**
 * Frames of silence driven on the posed table, on each side of the press.
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

/** The one card on the table, and the column and row it stands at. */
const CARD = "5H";
const COLUMN = 0;
const ROW = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.lift on the frame a press lifts a run into the hand, and on no frame either side", async () => {
  const cues = watchCues(h);
  openTable(h);
  poseColumn(h, COLUMN, [CARD]);
  assertEqual(
    h.snapshot().drag,
    null,
    "posing: nothing is in hand before the press (specs/instrumentation.md)",
  );
  await h.advance(QUIET_WINDOW);

  const at = await pressFrame(
    h,
    pressPoint(h.snapshot(), "tableau", COLUMN, ROW),
  );
  captureStill(h, "lift");

  assertNotNull(
    h.snapshot().drag,
    `the run in hand after the press on the ${CARD} in column ` +
      `${String(COLUMN)}, which is the lift whose cue this point reads ` +
      "(specs/controls.md)",
  );
  assertEqual(
    playedBefore(cues, at, CUES.lift),
    0,
    `times CUES.lift played over the ${String(QUIET_WINDOW)} frames before the ` +
      "press, on a table where nothing happened at all (specs/audio.md: a cue " +
      "is played on the frame its event happens)",
  );
  assertEqual(
    playedOn(cues, at, CUES.lift),
    1,
    "times CUES.lift played on the frame the press lifted the run, which is " +
      "its own frame and at most once on it (specs/audio.md)",
  );

  await h.advance(QUIET_WINDOW);
  assertEqual(
    playedAfter(cues, at, CUES.lift),
    0,
    `times CUES.lift played over the ${String(QUIET_WINDOW)} frames after the ` +
      "press, while the run stayed in hand and nothing was lifted again " +
      "(specs/audio.md: a cue is played on the frame its event happens)",
  );
});
