// audio/cue-home — a card a foundation accepts plays the home cue.
//
// specs/audio.md fixes `CUES.home` (`"home"`) as the cue played when "a card is
// accepted onto a foundation, by any move", and governs all ten with one sentence:
// "Each is played on the frame its event happens and at most once on that frame."
//
// So the measurement is: pose one Ace in a column with every foundation empty, run
// a quiet lead, press the Ace on one frame and release it over an empty foundation
// on the next, and read what sounded on the release's frame against what sounded on
// every frame before it — the quiet lead and the press frame included.
//
// THE CARD IS SENT HOME, NOT POSED. `addCard` puts a card on a foundation without a
// move putting it there, so it would never raise this cue, and the pointer
// operations are poses with no route to the engine's audio bus (`harness.ts`). The
// arrival read here is the build's own rules accepting the card, inside a frame's
// own update.
//
// AN ACE ONTO AN EMPTY FOUNDATION is the one arrival that needs no other card on
// the table: specs/foundations.md has an empty foundation accept "an Ace, of any
// suit", so the whole world is one card and one empty slot and nothing else can
// raise a cue of any name. The same frame legitimately raises `drop` as well —
// specs/audio.md has a frame that raises more than one cue play each of those once,
// and this point counts `home` alone.
//
// THE GESTURE IS SPLIT ACROSS TWO FRAMES, for the reason `audio/cue-drop` states: a
// press sharing the release's frame would hide a build that sounded `home` on the
// press rather than on the arrival.
//
// WHAT THIS DOES NOT DECIDE. What a foundation accepts, and which foundation a card
// belongs on, are the `foundations` group's requirements. This point reads the cue
// alone, and asks of the move only that the Ace reached the foundation.

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

/** The card that is sent home, where it waits, and the foundation it lands on. */
const CARD = "AS";
const FROM_COLUMN = 0;
const FROM_ROW = 0;
const FOUNDATION = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.home on the frame a foundation accepts a card, and on no frame either side", async () => {
  const cues = watchCues(h);
  openTable(h);
  const [ace] = poseColumn(h, FROM_COLUMN, [CARD]);
  assertEqual(
    h.snapshot().foundations[FOUNDATION].length,
    0,
    `posing: foundation ${String(FOUNDATION)} is empty, which is what makes ` +
      `it accept the ${CARD} (specs/foundations.md)`,
  );
  await h.advance(QUIET_WINDOW);

  await pressFrame(
    h,
    pressPoint(h.snapshot(), "tableau", FROM_COLUMN, FROM_ROW),
  );
  const at = await releaseFrame(
    h,
    releasePoint(h.snapshot(), "foundation", FOUNDATION),
  );
  captureStill(h, "home");

  const landed = placeOf(h.snapshot(), ace);
  assertDeepEqual(
    landed === null ? null : { pile: landed.pile, index: landed.index },
    { pile: "foundation", index: FOUNDATION },
    `the pile holding the ${CARD} after it was released over foundation ` +
      `${String(FOUNDATION)}, which is the arrival whose cue this point reads ` +
      "(specs/foundations.md)",
  );
  assertEqual(
    playedBefore(cues, at, CUES.home),
    0,
    `times CUES.home played over the ${String(QUIET_WINDOW)} quiet frames and ` +
      "the press frame before the release (specs/audio.md: a cue is played on " +
      "the frame its event happens)",
  );
  assertEqual(
    playedOn(cues, at, CUES.home),
    1,
    "times CUES.home played on the frame the foundation accepted the card, " +
      "which is its own frame and at most once on it (specs/audio.md)",
  );

  await h.advance(QUIET_WINDOW);
  assertEqual(
    playedAfter(cues, at, CUES.home),
    0,
    `times CUES.home played over the ${String(QUIET_WINDOW)} frames after the ` +
      "release, with nothing in hand and no card left to send home " +
      "(specs/audio.md: a cue is played on the frame its event happens)",
  );
});
