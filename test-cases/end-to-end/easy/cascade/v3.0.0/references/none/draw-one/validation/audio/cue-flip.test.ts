// audio/cue-flip — a move that turns a column's newly exposed card sounds one
// cue more than the same move that turns nothing.
//
// `specs/audio.md`'s cue table: `flip` is played when "A column's newly exposed
// card is turned face-up". `specs/tableau.md` fixes the event: "When an accepted
// move leaves a column whose lowest card is face-down, that card is turned
// face-up."
//
// WHY THIS POINT COUNTS RATHER THAN LISTENS FOR ONE SOUND. A flip never happens
// on its own: it is raised by an accepted move, and an accepted move raises
// `drop` on the same frame, so no board reaches a frame carrying `flip` alone.
// What `specs/audio.md` does fix is what a frame carrying two events sounds
// like: each cue "is played on the frame its event happens and at most once on
// that frame; a frame that raises more than one of them plays each of those
// once." So a frame carrying drop AND flip must emit strictly more sound than a
// frame carrying drop alone, whatever a single cue is made of — one oscillator
// or a tone and a noise burst — because the drop is the SAME cue in both.
//
// SO THE SAME GESTURE IS DRIVEN TWICE, and the two release frames are compared.
// The two boards differ in exactly one bit: whether the card left lowest in the
// column the run came from is face-down. Everything else is equal — the same
// card is carried, from the same column, onto the same card in the same column,
// released at the same point on the same target rectangle — so the difference
// between the two counts is the flip and nothing else.
//
// WHAT IS AND IS NOT OBSERVABLE HERE is the whole of `audio/cues`' module
// comment. This point reads a COUNT, never a name: it cannot tell which of the
// ten sounds the extra one was, and it is not trying to.
//
// A BUILD THAT BLIPS ON EVERY FRAME IS NOT LET THROUGH BY THE COMPARISON. Its
// blip lands on both release frames alike, so it cancels; a build that adds
// nothing for the flip still reads equal and still fails. The per-frame blip is
// what `audio/cue-drop` and its siblings grade.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { CARD_H, CARD_W } from "../constants";
import {
  captureStill,
  card,
  cards,
  columnCardTopLeft,
  createHarness,
  dropRect,
  framesFor,
  openTable,
  poseColumn,
  rectCenter,
  watchCues,
  type Harness,
  type Point,
} from "../harness";
import { realDrop, soundsOn } from "./cues";

/** Quiet play driven after each drop, so the still shows the settled table. */
const SETTLE_FRAMES = framesFor(0.2);

/** The card carried in both drives, and the black six that accepts it. */
const CARRIED = "5H";
const BURIED = "9C";
const TARGET_CARD = "6S";
const FROM = 0;
const ONTO = 1;

/**
 * A point inside a column's lowest card and inside no card above it.
 *
 * `specs/controls.md` resolves a press to "the lowest of the cards whose
 * footprint contains that point", so a point below the card above's bottom edge
 * names the lowest card whichever way a build reads an overlap. It is geometry
 * from `specs/table.md`'s offsets, not a tolerance.
 */
function pressOnLowest(col: number, faces: readonly boolean[]): Point {
  const lowest = columnCardTopLeft(col, faces.length - 1, faces);
  const above = columnCardTopLeft(col, faces.length - 2, faces);
  return {
    x: lowest.x + CARD_W / 2,
    y: (above.y + CARD_H + (lowest.y + CARD_H)) / 2,
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("sounds more on the drop that turns an exposed card than on the drop that turns none", async () => {
  await h.armAudio();
  const played = watchCues(h);
  const target = rectCenter(dropRect("tableau", ONTO, [true]));

  // ---- The drop that turns a card: a face-down card is left lowest. ---------
  await openTable(h);
  await poseColumn(h, FROM, [card(BURIED, false), card(CARRIED)]);
  await poseColumn(h, ONTO, cards(TARGET_CARD));

  const turningFaces = [false, true];
  const turning = await realDrop(h, pressOnLowest(FROM, turningFaces), target);
  const onTheTurningDrop = soundsOn([...played], turning.dropFrame);
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "flip");

  // ---- The same drop over a face-up card, which turns nothing. --------------
  await openTable(h);
  await poseColumn(h, FROM, [card(BURIED), card(CARRIED)]);
  await poseColumn(h, ONTO, cards(TARGET_CARD));

  const quietFaces = [true, true];
  const quiet = await realDrop(h, pressOnLowest(FROM, quietFaces), target);
  const onTheQuietDrop = soundsOn([...played], quiet.dropFrame);
  await h.advance(SETTLE_FRAMES);

  // Both moves really happened, and exactly one of them turned a card.
  assertEqual(
    turning.lifted,
    true,
    "the press to lift the run over the buried card",
  );
  assertEqual(
    turning.snapshot.tableau[ONTO].length,
    2,
    "the cards on the target column after the drop that turns a card",
  );
  assertEqual(
    turning.snapshot.tableau[FROM][0]?.faceUp,
    true,
    "the face of the newly exposed card, which the move turns up",
  );
  assertEqual(
    quiet.lifted,
    true,
    "the press to lift the run over the face-up card",
  );
  assertEqual(
    quiet.snapshot.tableau[ONTO].length,
    2,
    "the cards on the target column after the drop that turns nothing",
  );
  assertEqual(
    quiet.snapshot.tableau[FROM][0]?.faceUp,
    true,
    "the face of the card left lowest by the drop that turns nothing",
  );

  assertGreaterThan(
    onTheTurningDrop,
    onTheQuietDrop,
    `sounds on frame ${turning.dropFrame}, the drop that turned a card, against the ${onTheQuietDrop} on frame ${quiet.dropFrame}, the drop that turned none`,
  );
});
