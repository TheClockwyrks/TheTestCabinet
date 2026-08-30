// audio/cue-flip — a move that turns a column's newly exposed card plays the flip
// cue.
//
// specs/audio.md fixes `CUES.flip` (`"flip"`) as the cue played when "a column's
// newly exposed card is turned face-up", and governs all ten with one sentence:
// "Each is played on the frame its event happens and at most once on that frame."
// specs/tableau.md fixes the event itself: "When an accepted move leaves a column
// whose lowest card is face-down, that card is turned face-up."
//
// So the measurement is: pose a face-down card with one face-up card below it on
// a column, run a quiet lead, move that face-up card to a column that accepts it,
// and read what the bus announced across the move. The move leaves the face-down
// card lowest, so the turn happens; the card is checked face-up before the cue is
// read, so a build that sounded the cue and turned nothing fails here.
//
// THE MOVE IS THE GAME'S OWN. `move()` is one of the four operations that route
// through exactly the code a player's gesture routes through, and "an accepted
// move applies through the same path a released drop uses, so a newly exposed
// column card turns" (specs/instrumentation.md). Reaching the same event through
// a press and a release would drag `audio/cue-lift`'s and `audio/cue-drop`'s
// requirements into this point's verdict for nothing.
//
// THE WINDOW HOLDS TWO EVENTS, AND ONLY ONE OF THEM IS THIS POINT'S. An accepted
// move raises `drop` as well, since the pile it resolved to accepted it, and
// specs/audio.md says as much: "a frame that raises more than one of them plays
// each of those once." So this point counts `flip` and reads nothing about the
// other names — `audio/cue-drop` decides that one, on a move that turns nothing.

import { afterEach, beforeEach, it } from "vitest";
import { CUES, DOUBLE_CLICK_WINDOW } from "../../src/constants";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import {
  captureStill,
  card,
  cardById,
  createHarness,
  down,
  framesFor,
  openTable,
  poseColumn,
  watchCues,
  type Harness,
} from "../harness";
import { playedSince } from "./cues";

/**
 * Frames of silence driven on the posed table before the move, and again after
 * it.
 *
 * A whole `DOUBLE_CLICK_WINDOW` (`0.30` s, specs/controls.md), which is the
 * longest span this case fixes anywhere — the launch interval, the only other
 * duration in the case, is `0.18` s (specs/victory.md). So a build that sounds a
 * cue on any period the case names has to cross a window longer than its own
 * period without sounding anything.
 */
const QUIET = framesFor(DOUBLE_CLICK_WINDOW);

/**
 * The source column, posted bottom card first: a face-down card with a red five
 * below it. Moving the five leaves the face-down card lowest, which is the card
 * the move turns (specs/tableau.md).
 */
const BURIED = down(card("clubs", 9));
const RUN = card("hearts", 5);
const FROM_COLUMN = 0;
const FROM_ROW = 1;

/** The card the run lands on: a black six, one rank higher and the other colour. */
const TARGET = card("spades", 6);
const TO_COLUMN = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.flip once when an accepted move turns the column's newly exposed card, and not on the quiet frames either side", async () => {
  openTable(h);
  const [buried] = poseColumn(h, FROM_COLUMN, [BURIED, RUN]);
  poseColumn(h, TO_COLUMN, [TARGET]);
  const cues = watchCues(h);

  await h.advance(QUIET);
  assertEqual(
    h.snapshot().muted,
    false,
    "posing: the game is not muted, so a cue the build asks for here is one " +
      "it can be heard playing (specs/audio.md)",
  );
  assertEqual(
    cardById(h.snapshot(), buried)?.faceUp,
    false,
    "posing: the card under the run lies face-down, so the move below is what " +
      "turns it (specs/tableau.md)",
  );
  assertEqual(
    h.snapshot().autoFlip,
    true,
    "posing: the turning of a newly exposed card is left on, which is the " +
      "faculty this point exercises (specs/instrumentation.md)",
  );
  assertLength(
    playedSince(cues, 0, CUES.flip),
    0,
    `times CUES.flip played over the ${String(QUIET)} frames before the move, ` +
      "on a table where nothing happened at all (specs/audio.md: a cue is " +
      "played on the frame its event happens)",
  );

  // The window: the call the move happens on, and the frame that follows it.
  const mark = cues.length;
  const accepted = h.debug.move(
    "tableau",
    FROM_COLUMN,
    FROM_ROW,
    "tableau",
    TO_COLUMN,
  );
  await h.advance(1);
  captureStill(h, "flip");
  const sounded = playedSince(cues, mark, CUES.flip);

  assertEqual(
    accepted,
    true,
    "the verdict on moving the red five onto the black six, which a column " +
      "accepts (specs/tableau.md)",
  );
  assertEqual(
    cardById(h.snapshot(), buried)?.faceUp,
    true,
    "the face of the newly exposed card after the move, which is the turn " +
      "whose cue this point reads (specs/tableau.md)",
  );
  assertLength(
    sounded,
    1,
    "times CUES.flip played across the move that turned it, which plays it " +
      "once and at most once on its frame (specs/audio.md)",
  );
  assertGreaterThan(
    sounded[0].gain,
    0,
    "the gain CUES.flip sounded at on an unmuted game, which is what makes it " +
      "a sound the player hears (specs/audio.md)",
  );

  const after = cues.length;
  await h.advance(QUIET);
  assertLength(
    playedSince(cues, after, CUES.flip),
    0,
    `times CUES.flip played over the ${String(QUIET)} frames after the move, ` +
      "on a table nothing is touching (specs/audio.md: a cue is played on the " +
      "frame its event happens)",
  );
});
