// instrumentation/surface-live — the surface is wired to the running game rather
// than to a plausible-looking object beside it.
//
// THE RULE. `specs/instrumentation.md` makes the surface a deliverable: "Every
// scenario driven from code reaches the game through it", and "A pose arranges
// the table, and the game's own move rules, turning, win test, and cascade run
// from there exactly as they do in play, so a scenario driven from code behaves
// exactly like one played by hand."
//
// WHY IT IS ITS OWN POINT, AND WHY IT IS `broken`. A surface that answers every
// call and reports a state unconnected to the game passes reflection — which is
// `instrumentation/surface-present`'s reading — and then fails every other point
// in this suite for reasons that name the wrong mechanic. This is the point that
// catches it, and a grade that names it is worth more than fifty grades that name
// a mechanic.
//
// THE SURFACE IS DRIVEN BOTH WAYS ROUND. A POSE is read back, and an EVENT is
// applied by the game's own rules:
//
//   - `addCard` puts one named card on a column and `snapshot` reports that card,
//     on that column, with the face it was given.
//   - `move` sends an Ace from a column to an empty foundation, which
//     `specs/foundations.md` accepts, and the card is reported on the foundation
//     afterwards with the column left empty.
//
// THE POSED CARD IS THE DISTINGUISHING ONE. It is the seven of hearts posed
// FACE-DOWN, so each wrong model reads as a different answer: a build whose
// `addCard` ignores `faceUp` reports it face-up, one that ignores the suit or the
// rank reports another card, one that adds to the wrong pile reports an empty
// column, and one whose surface is a fiction reports nothing at all.
//
// WHAT THIS DOES NOT DECIDE. Not what any particular operation means — every one
// of them has its own point in this group — and not the foundation rule the move
// leans on, which is `foundations/accepts-ace-when-empty`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { RANK_MIN } from "../constants";
import {
  captureStill,
  card,
  createHarness,
  failSurface,
  openTable,
  pileOf,
  poseColumn,
  topOf,
  type CardView,
  type Harness,
} from "../harness";

/** The column the posed card is put on, and the card itself. */
const POSED_COLUMN = 3;

/**
 * The card posed onto it: the seven of hearts, FACE-DOWN.
 *
 * The distinguishing pose. `addCard` takes a suit, a rank and a face
 * (`specs/instrumentation.md`), and a build that drops any one of the three reads
 * back as a different card — face-up, another suit, another rank — rather than as
 * a single indistinct wrong answer.
 */
const POSED_CARD = "7H";
const POSED_FACE_UP = false;

/** The column the Ace is moved from, and the foundation it is moved to. */
const MOVE_COLUMN = 0;
const MOVE_FOUNDATION = 0;

/** The Ace that is sent home: an empty foundation accepts an Ace of any suit. */
const MOVED_CARD = "AS";

/** One card as `"suit-rank-face"`, so a wrong face reads as a wrong card. */
function print(view: CardView | undefined): string {
  return view === undefined
    ? "no card"
    : `${view.suit}-${view.rank}-${view.faceUp ? "up" : "down"}`;
}

/** The same, for a card this check named rather than read. */
function printed(text: string, faceUp: boolean): string {
  const spec = card(text, faceUp);
  return `${spec.suit}-${spec.rank}-${faceUp ? "up" : "down"}`;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads a pose back and applies an event through the game's own rules", async () => {
  // The surface itself first, so a build that installed nothing is named for
  // exactly that rather than failing later on a call it never had.
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);

  // An empty table, live and at rest: nothing on it but the two cards below.
  await openTable(h);

  await poseColumn(h, POSED_COLUMN, [card(POSED_CARD, POSED_FACE_UP)]);
  await poseColumn(h, MOVE_COLUMN, [card(MOVED_CARD)]);

  // Read before a frame runs: the harness holds the game off the wall clock, so
  // nothing stands between the pose and the reading that checks it.
  const posed = await h.snapshot();

  const accepted = await h.debug.move(
    "tableau",
    MOVE_COLUMN,
    0,
    "foundation",
    MOVE_FOUNDATION,
  );
  const applied = await h.snapshot();

  await h.advance(1);
  // Before the assertions, so a failing check still leaves the picture of the
  // board the surface drove.
  await captureStill(h, "live");

  assertEqual(
    print(topOf(pileOf(posed, "tableau", POSED_COLUMN))),
    printed(POSED_CARD, POSED_FACE_UP),
    `the card snapshot() reports on column ${POSED_COLUMN} after ` +
      `addCard("tableau", ${POSED_COLUMN}, "hearts", 7, ${POSED_FACE_UP}) — ` +
      `"no card" means the pose never reached the game`,
  );

  assertEqual(
    accepted,
    true,
    `the verdict move() returned on sending the ${MOVED_CARD} from column ` +
      `${MOVE_COLUMN} to the empty foundation ${MOVE_FOUNDATION}, which ` +
      `accepts an Ace of any suit (specs/foundations.md)`,
  );
  assertEqual(
    print(topOf(pileOf(applied, "foundation", MOVE_FOUNDATION))),
    printed(MOVED_CARD, true),
    `the card on foundation ${MOVE_FOUNDATION} once the move was accepted — ` +
      `a pose the game's own rules never acted on leaves it empty`,
  );
  assertLength(
    pileOf(applied, "tableau", MOVE_COLUMN),
    0,
    `the cards left in column ${MOVE_COLUMN} once its only card, of rank ` +
      `${RANK_MIN}, went home`,
  );
});
