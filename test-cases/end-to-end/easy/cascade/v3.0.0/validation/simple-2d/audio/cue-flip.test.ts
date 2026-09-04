// audio/cue-flip — turning a newly exposed card plays the flip cue.
//
// specs/audio.md fixes `CUES.flip` (`"flip"`) as the cue played when "a column's
// newly exposed card is turned face-up", and governs all ten with one sentence:
// "Each is played on the frame its event happens and at most once on that frame."
//
// So the measurement is: pose a column holding a face-down card under one face-up
// card, and a second column that accepts that face-up card; run a quiet lead; press
// the face-up card on one frame and release it over the accepting column on the
// next. specs/tableau.md then turns the face-down card the move exposed, and this
// point reads what sounded on that frame against what sounded on the frames before
// it — the quiet lead and the press frame included.
//
// THE CARD IS TURNED BY A MOVE, NOT BY A POSE. The surface's `setCardFaceUp` turns
// a card without a move turning it, so it would never raise this cue, and the
// pointer operations are poses with no route to the engine's audio bus
// (`harness.ts`). The turn read here is the one the build's own rules perform when
// an accepted move leaves a face-down card lowest, inside a frame's own update.
//
// `autoFlip` IS LEFT ON, which is what a player gets and what makes the turn part
// of the move at all (specs/instrumentation.md). It is the one faculty this
// requirement exercises; `instrumentation/auto-flip-gate` decides the gate itself.
//
// THE GESTURE IS SPLIT ACROSS TWO FRAMES, for the reason `audio/cue-drop` states: a
// press sharing the release's frame would hide a build that sounded `flip` on the
// press rather than on the turn.
//
// TWO COLUMNS ARE THE WHOLE TABLE, so nothing else can raise a cue of any name, and
// the same frame legitimately raises `drop` as well — specs/audio.md has a frame
// that raises more than one cue play each of those once, and this point counts
// `flip` alone.
//
// WHAT THIS DOES NOT DECIDE. That exactly one card turns, and that a move which
// empties a column turns nothing, are the `tableau` group's requirements. This
// point reads the cue alone, and asks of the move only that the buried card came
// up face-up.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CUES, DOUBLE_CLICK_WINDOW } from "../constants";
import {
  cardOf,
  captureStill,
  createHarness,
  framesFor,
  openTable,
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
 * The column the move empties of face-up cards, and the column that takes them.
 *
 * The buried `#7D` is face-down and is the card the move exposes; the `5H` above it
 * is the run that leaves, and the black six takes a red five (specs/tableau.md).
 */
const BURIED = "#7D";
const RUN = "5H";
const FROM_COLUMN = 0;
const RUN_ROW = 1;
const TARGET = "6S";
const TO_COLUMN = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.flip on the frame an accepted move turns the newly exposed card, and on no frame either side", async () => {
  const cues = watchCues(h);
  openTable(h);
  const [buried] = poseColumn(h, FROM_COLUMN, [BURIED, RUN]);
  poseColumn(h, TO_COLUMN, [TARGET]);
  assertEqual(
    cardOf(h.snapshot(), buried).faceUp,
    false,
    `posing: the ${BURIED} under the ${RUN} is face-down, so the move below ` +
      "is what exposes and turns it (specs/tableau.md)",
  );
  assertEqual(
    h.snapshot().autoFlip,
    true,
    "posing: the turning of a newly exposed card is on, which is the faculty " +
      "this requirement exercises (specs/instrumentation.md)",
  );
  await h.advance(QUIET_WINDOW);

  await pressFrame(
    h,
    pressPoint(h.snapshot(), "tableau", FROM_COLUMN, RUN_ROW),
  );
  const at = await releaseFrame(
    h,
    releasePoint(h.snapshot(), "tableau", TO_COLUMN),
  );
  captureStill(h, "flip");

  assertEqual(
    cardOf(h.snapshot(), buried).faceUp,
    true,
    `the face of the ${BURIED} after the ${RUN} left the column, which is the ` +
      "turn whose cue this point reads (specs/tableau.md)",
  );
  assertEqual(
    playedBefore(cues, at, CUES.flip),
    0,
    `times CUES.flip played over the ${String(QUIET_WINDOW)} quiet frames and ` +
      "the press frame before the release, while the card was still face-down " +
      "(specs/audio.md: a cue is played on the frame its event happens)",
  );
  assertEqual(
    playedOn(cues, at, CUES.flip),
    1,
    "times CUES.flip played on the frame the exposed card was turned " +
      "face-up, which is its own frame and at most once on it (specs/audio.md)",
  );

  await h.advance(QUIET_WINDOW);
  assertEqual(
    playedAfter(cues, at, CUES.flip),
    0,
    `times CUES.flip played over the ${String(QUIET_WINDOW)} frames after the ` +
      "release, with the exposed card already face-up and no card left to " +
      "turn (specs/audio.md: a cue is played on the frame its event happens)",
  );
});
