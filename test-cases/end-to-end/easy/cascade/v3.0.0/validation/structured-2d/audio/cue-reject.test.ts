// audio/cue-reject — a release a pile refuses plays the reject cue.
//
// specs/audio.md fixes `CUES.reject` (`"reject"`) as the cue played when "a drop
// returns its run to the pile it was lifted from", and governs all ten with one
// sentence: "Each is played on the frame its event happens and at most once on
// that frame."
//
// So the measurement is: pose a red five on one column and a BLACK five on
// another, run a quiet lead, lift the red five, carry it over the black five and
// release it there. A column accepts only a run led by a card one rank lower and
// of the opposite colour (specs/tableau.md), so this release resolves to a pile
// that refuses it and the run returns to where it was lifted from — which is
// exactly the event this cue answers.
//
// THE PRESS IS OUTSIDE THE WINDOW, DELIBERATELY. The gesture is split: the press
// is made before the window opens, so a build that sounded `reject` on the press
// rather than on the release fails the lead's reading, and the count the window
// carries is the release's alone.
//
// THIS IS THE OPPOSITE DIRECTION FROM `audio/cue-drop`, AND ITS OWN POINT. A
// build that sounds `drop` on every release, accepted or not, plays the right cue
// for an accepted drop and the wrong one for a refused one; the two are different
// defects and grade apart. So this point asserts the refusal's cue alone, and
// says nothing about what an accepted drop sounds.
//
// THE REFUSAL IS PROVED BY THE TABLE. specs/tableau.md: "A refused move changes
// nothing. Every card it carried returns to the pile it was taken from." The red
// five is checked back on its own column and the target left holding only its own
// card before the cue is read, so a build that sounded the cue and moved the card
// anyway fails here rather than passing on the noise.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
} from "../assert";
import { CUES, DOUBLE_CLICK_WINDOW } from "../constants";
import {
  captureStill,
  card,
  createHarness,
  dropRectIn,
  framesFor,
  grabPoint,
  movePointerTo,
  openTable,
  poseColumn,
  pressAt,
  rectCenter,
  releaseAt,
  siteOf,
  watchCues,
  type Harness,
} from "../harness";
import { playedSince } from "./cues";

/**
 * Frames of silence driven on the posed table before the gesture, and again
 * after it.
 *
 * A whole `DOUBLE_CLICK_WINDOW` (`0.30` s, specs/controls.md), which is the
 * longest span this case fixes anywhere — the launch interval, the only other
 * duration in the case, is `0.18` s (specs/victory.md). So a build that sounds a
 * cue on any period the case names has to cross a window longer than its own
 * period without sounding anything.
 */
const QUIET = framesFor(DOUBLE_CLICK_WINDOW);

/**
 * The run that is carried and the card it is offered to: a red five onto a black
 * FIVE, which is the same rank rather than one higher, so the column refuses it
 * (specs/tableau.md).
 */
const RUN = card("hearts", 5);
const TARGET = card("clubs", 5);
const FROM_COLUMN = 0;
const FROM_ROW = 0;
const TO_COLUMN = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.reject once when a release is refused by the column it resolved to, and not on the quiet frames either side", async () => {
  openTable(h);
  const [id] = poseColumn(h, FROM_COLUMN, [RUN]);
  poseColumn(h, TO_COLUMN, [TARGET]);
  const cues = watchCues(h);

  await h.advance(QUIET);
  assertEqual(
    h.snapshot().muted,
    false,
    "posing: the game is not muted, so a cue the build asks for here is one " +
      "it can be heard playing (specs/audio.md)",
  );

  // The press, outside the window: what it sounds is `audio/cue-lift`'s reading.
  const from = grabPoint(h.snapshot(), FROM_COLUMN, FROM_ROW);
  const to = rectCenter(dropRectIn(h.snapshot(), "tableau", TO_COLUMN));
  pressAt(h, from.x, from.y);
  await h.advance(1);
  assertLength(
    playedSince(cues, 0, CUES.reject),
    0,
    `times CUES.reject played over the ${String(QUIET)} quiet frames and the ` +
      "press that lifted the run, neither of which is a refused drop " +
      "(specs/audio.md: a cue is played on the frame its event happens)",
  );

  // The window: the release the column refuses, and the frame that follows it.
  const mark = cues.length;
  movePointerTo(h, to.x, to.y);
  releaseAt(h, to.x, to.y);
  await h.advance(1);
  captureStill(h, "reject");
  const sounded = playedSince(cues, mark, CUES.reject);

  const landed = siteOf(h.snapshot(), id);
  assertDeepEqual(
    landed === undefined ? null : { pile: landed.pile, index: landed.index },
    { pile: "tableau", index: FROM_COLUMN },
    "the pile holding the red five after it was released over the black " +
      "five, which refuses it, so the run returned to where it was lifted " +
      "from (specs/tableau.md)",
  );
  assertLength(
    h.snapshot().tableau[TO_COLUMN],
    1,
    "cards on the column the run was refused by, which keeps what it held " +
      "(specs/tableau.md)",
  );
  assertLength(
    sounded,
    1,
    "times CUES.reject played across the refused release, which plays it once " +
      "and at most once on its frame (specs/audio.md)",
  );
  assertGreaterThan(
    sounded[0].gain,
    0,
    "the gain CUES.reject sounded at on an unmuted game, which is what makes " +
      "it a sound the player hears (specs/audio.md)",
  );

  const after = cues.length;
  await h.advance(QUIET);
  assertLength(
    playedSince(cues, after, CUES.reject),
    0,
    `times CUES.reject played over the ${String(QUIET)} frames after the ` +
      "release, on a table nothing is touching (specs/audio.md: a cue is " +
      "played on the frame its event happens)",
  );
});
