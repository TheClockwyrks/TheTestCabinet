// audio/cue-reject — a drop the target refuses plays the reject cue.
//
// specs/audio.md fixes `CUES.reject` (`"reject"`) as the cue played when "a drop
// returns its run to the pile it was lifted from", and governs all ten with one
// sentence: "Each is played on the frame its event happens and at most once on that
// frame."
//
// So the measurement is: pose a run and a column that REFUSES it, run a quiet lead,
// press the run on one frame, carry it over the refusing column and release it on
// the next frame, and read what sounded on the release's frame against what sounded
// on every frame before it — the quiet lead and the press frame included.
//
// THIS IS `audio/cue-drop`'S OTHER DIRECTION, AND ITS OWN POINT. specs/controls.md
// sends the same gesture down one of two paths depending on what the target says,
// so a build that sounds `drop` for both, or `reject` for both, is broken in one
// direction only and must grade that way.
//
// THE TARGET REFUSES BUT IS STILL A TARGET. specs/tableau.md has a column whose
// lowest card is the black nine accept only a run led by a red eight, so a red five
// released over it resolves to a pile that refuses it — which is the "release onto
// an illegal target" this point is about, rather than a release over bare felt
// where the run resolves to no pile at all. Both return the run and both raise
// `reject` (specs/controls.md), and the illegal target is the case the point names.
//
// THE DROP IS RELEASED, NOT POSED, and the gesture is split across two frames, for
// the reasons `audio/cue-drop` states: a posed release cannot reach the engine's
// audio bus, and a press sharing the release's frame would hide a build that
// sounded `reject` on the press.
//
// WHAT THIS DOES NOT DECIDE. What a column refuses, and that a refused move leaves
// the board exactly as it was, are the `tableau` and `handling` groups'
// requirements. This point reads the cue alone, and asks of the release only that
// the run came back.

import { afterEach, beforeEach, it } from "vitest";
import { CUES, DOUBLE_CLICK_WINDOW } from "../../src/constants";
import { assertDeepEqual, assertEqual } from "../assert";
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
 * The run that is carried, and the column that turns it away.
 *
 * A red five over a black nine: neither one rank lower nor a King onto an empty
 * column, so specs/tableau.md has the column refuse it.
 */
const RUN = "5H";
const FROM_COLUMN = 0;
const FROM_ROW = 0;
const TARGET = "9S";
const TO_COLUMN = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.reject on the frame a release is refused and the run returns, and on no frame either side", async () => {
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
  captureStill(h, "reject");

  const returned = placeOf(h.snapshot(), run);
  assertDeepEqual(
    returned === null ? null : { pile: returned.pile, index: returned.index },
    { pile: "tableau", index: FROM_COLUMN },
    `the pile holding the ${RUN} after it was released over the ${TARGET}, ` +
      "which refuses it, so the run returns to the column it was lifted from " +
      "(specs/controls.md, specs/tableau.md)",
  );
  assertEqual(
    playedBefore(cues, at, CUES.reject),
    0,
    `times CUES.reject played over the ${String(QUIET_WINDOW)} quiet frames and ` +
      "the press frame before the release (specs/audio.md: a cue is played on " +
      "the frame its event happens)",
  );
  assertEqual(
    playedOn(cues, at, CUES.reject),
    1,
    "times CUES.reject played on the frame the refused release returned the " +
      "run, which is its own frame and at most once on it (specs/audio.md)",
  );

  await h.advance(QUIET_WINDOW);
  assertEqual(
    playedAfter(cues, at, CUES.reject),
    0,
    `times CUES.reject played over the ${String(QUIET_WINDOW)} frames after ` +
      "the release, with nothing in hand and nothing left to refuse " +
      "(specs/audio.md: a cue is played on the frame its event happens)",
  );
});
