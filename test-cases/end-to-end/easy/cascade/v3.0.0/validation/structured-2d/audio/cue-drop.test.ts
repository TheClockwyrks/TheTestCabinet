// audio/cue-drop — a release a pile accepts plays the drop cue.
//
// specs/audio.md fixes `CUES.drop` (`"drop"`) as the cue played when "a drop is
// accepted by the pile it resolved to", and governs all ten with one sentence:
// "Each is played on the frame its event happens and at most once on that frame."
//
// So the measurement is: pose a red five on one column and a black six on
// another, run a quiet lead, lift the five, carry it over the six and release it
// there — a run a column accepts, by specs/tableau.md — and read what the bus
// announced across the release against what it announced before and after it.
//
// THE PRESS IS OUTSIDE THE WINDOW, DELIBERATELY. The gesture is split: the press
// is made before the window opens, so a build that sounded `drop` on the press
// rather than on the release fails the lead's reading, and the count the window
// carries is the release's alone. `audio/cue-lift` decides what the press sounds.
//
// THE TARGET IS A COLUMN, NOT A FOUNDATION, AND THE SOURCE COLUMN EMPTIES. So the
// accepted move raises this cue and nothing else in the cue table: no card
// reaches a foundation (`home`), no newly exposed card is turned (`flip`, which
// needs a face-down card left behind), and no board is completed (`win`). The
// point is graded on the drop alone.
//
// THE RELEASE POINT IS THE TARGET COLUMN'S DROP RECTANGLE'S CENTRE, and the press
// was made at the card's own centre, so the run in hand carries no offset and the
// leading card's centre lands exactly there — which is where specs/controls.md
// resolves a drop. `handling/drop-target-by-position` decides that rule; this
// point only needs a release the column accepts, and checks the card really
// landed there before reading what sounded.

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
 * The run that is carried and the card it lands on: a red five onto a black six,
 * which is one rank lower and the opposite colour, so the column accepts it
 * (specs/tableau.md).
 */
const RUN = card("hearts", 5);
const TARGET = card("spades", 6);
const FROM_COLUMN = 0;
const FROM_ROW = 0;
const TO_COLUMN = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.drop once when a release is accepted by the column it resolved to, and not on the quiet frames either side", async () => {
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
    playedSince(cues, 0, CUES.drop),
    0,
    `times CUES.drop played over the ${String(QUIET)} quiet frames and the ` +
      "press that lifted the run, neither of which is a drop (specs/audio.md: " +
      "a cue is played on the frame its event happens)",
  );

  // The window: the release the column accepts, and the frame that follows it.
  const mark = cues.length;
  movePointerTo(h, to.x, to.y);
  releaseAt(h, to.x, to.y);
  await h.advance(1);
  captureStill(h, "drop");
  const sounded = playedSince(cues, mark, CUES.drop);

  const landed = siteOf(h.snapshot(), id);
  assertDeepEqual(
    landed === undefined ? null : { pile: landed.pile, index: landed.index },
    { pile: "tableau", index: TO_COLUMN },
    "the pile holding the red five after it was released over the black six, " +
      "which is the accepted drop whose cue this point reads " +
      "(specs/tableau.md, specs/controls.md)",
  );
  assertLength(
    sounded,
    1,
    "times CUES.drop played across the accepted release, which plays it once " +
      "and at most once on its frame (specs/audio.md)",
  );
  assertGreaterThan(
    sounded[0].gain,
    0,
    "the gain CUES.drop sounded at on an unmuted game, which is what makes it " +
      "a sound the player hears (specs/audio.md)",
  );

  const after = cues.length;
  await h.advance(QUIET);
  assertLength(
    playedSince(cues, after, CUES.drop),
    0,
    `times CUES.drop played over the ${String(QUIET)} frames after the ` +
      "release, on a table nothing is touching (specs/audio.md: a cue is " +
      "played on the frame its event happens)",
  );
});
