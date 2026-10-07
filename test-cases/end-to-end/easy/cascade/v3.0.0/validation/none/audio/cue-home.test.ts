// audio/cue-home — a card accepted onto a foundation sounds one cue more than the
// same card accepted onto a column.
//
// `specs/audio.md`'s cue table: `home` is played when "A card is accepted onto a
// foundation, by any move", and the same file states the overlap this point
// turns on outright: "A drop accepted by a foundation raises both `drop` and
// `home`."
//
// WHY THIS POINT COUNTS RATHER THAN LISTENS FOR ONE SOUND. A card reaching a
// foundation is always the outcome of an accepted move, and an accepted move
// raises `drop` on the same frame, so no board reaches a frame carrying `home`
// alone. What `specs/audio.md` does fix is what a frame carrying two events
// sounds like: each cue "is played on the frame its event happens and at most
// once on that frame; a frame that raises more than one of them plays each of
// those once." So a frame carrying drop AND home must emit strictly more sound
// than a frame carrying drop alone, whatever a single cue is made of, because
// the drop is the SAME cue in both.
//
// SO THE SAME CARD IS DROPPED TWICE, and the two release frames are compared.
// The Ace of spades is lifted from the same column in both drives; once it is
// released over an empty foundation, which `specs/foundations.md` has accept "An
// Ace, of any suit", and once over a red two on a column, which
// `specs/tableau.md` has accept a black Ace. Both drops are accepted, so both
// frames carry `drop`, and only the first carries `home`.
//
// WHAT IS AND IS NOT OBSERVABLE HERE is the whole of `audio/cues`' module
// comment. This point reads a COUNT, never a name.
//
// A BUILD THAT BLIPS ON EVERY FRAME IS NOT LET THROUGH BY THE COMPARISON: its
// blip lands on both release frames alike and cancels.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  cardCenter,
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
} from "../harness";
import { realDrop, soundsOn } from "./cues";

/** Quiet play driven after each drop, so the still shows the settled table. */
const SETTLE_FRAMES = framesFor(0.2);

/** The card sent home, and the red two a column offers it in the control drive. */
const CARRIED = "AS";
const COLUMN_CARD = "2H";
const FROM = 0;
const ONTO_COLUMN = 1;
const ONTO_FOUNDATION = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("sounds more on the drop a foundation accepts than on the drop a column accepts", async () => {
  await h.armAudio();
  const played = watchCues(h);
  const at = columnCardTopLeft(FROM, 0, [true]);
  const press = cardCenter(at.x, at.y);

  // ---- The Ace onto an empty foundation. -----------------------------------
  await openTable(h);
  await poseColumn(h, FROM, cards(CARRIED));

  const home = await realDrop(
    h,
    press,
    rectCenter(dropRect("foundation", ONTO_FOUNDATION)),
  );
  const onTheFoundationDrop = soundsOn([...played], home.dropFrame);
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "home");

  // ---- The same Ace onto a column that accepts it. -------------------------
  await openTable(h);
  await poseColumn(h, FROM, cards(CARRIED));
  await poseColumn(h, ONTO_COLUMN, cards(COLUMN_CARD));

  const onto = await realDrop(
    h,
    press,
    rectCenter(dropRect("tableau", ONTO_COLUMN, [true])),
  );
  const onTheColumnDrop = soundsOn([...played], onto.dropFrame);
  await h.advance(SETTLE_FRAMES);

  // Both drops were accepted, and exactly one of them put a card on a foundation.
  assertEqual(
    home.lifted,
    true,
    "the press to lift the Ace before the foundation drop",
  );
  assertEqual(
    home.snapshot.foundations[ONTO_FOUNDATION].length,
    1,
    "the cards on the foundation the Ace was dropped on",
  );
  assertEqual(
    onto.lifted,
    true,
    "the press to lift the Ace before the column drop",
  );
  assertEqual(
    onto.snapshot.tableau[ONTO_COLUMN].length,
    2,
    "the cards on the column the Ace was dropped on",
  );
  assertEqual(
    onto.snapshot.foundations.map((pile) => pile.length).join(","),
    "0,0,0,0",
    "the cards on each foundation after the drop that went to a column",
  );

  assertGreaterThan(
    onTheFoundationDrop,
    onTheColumnDrop,
    `sounds on frame ${home.dropFrame}, the drop a foundation accepted, against the ${onTheColumnDrop} on frame ${onto.dropFrame}, the drop a column accepted`,
  );
});
