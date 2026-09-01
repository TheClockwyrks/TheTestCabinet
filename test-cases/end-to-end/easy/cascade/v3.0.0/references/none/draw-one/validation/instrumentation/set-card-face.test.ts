// instrumentation/set-card-face — `setCardFaceUp` turns the one card its id
// names, either way, and turns no other card.
//
// THE RULE. `specs/instrumentation.md`: `setCardFaceUp(id, faceUp)` "Sets one
// card's face."
//
// IT IS POSED BOTH WAYS, because a field read back once could be a constant: the
// named card is set face-up, read, set face-down, and read again. A build whose
// operation only ever turns a card up passes the first reading and fails the
// second, and the failure says which direction it was.
//
// AND EVERY OTHER CARD IS READ AT BOTH STEPS. The plausible defect is not that
// the operation does nothing but that it does too much — turning the whole
// column, turning every card of that rank, or turning the pile's lowest card
// instead of the one named — so the board carries four other cards with three
// different faces between them, on two different columns, and each is held to the
// face it was posed with after each of the two poses.
//
// THE CARD NAMED IS IN THE MIDDLE OF ITS COLUMN AND IS NOT THE LOWEST, so a build
// that turns "the column's exposed card" rather than the card named reads as a
// different answer, and so the automatic flip `specs/tableau.md` states — which
// belongs to an accepted move, and no move is made here — cannot be confused with
// the pose.
//
// WHAT THIS DOES NOT DECIDE. The automatic flip itself, which is
// `instrumentation/auto-flip-gate`'s and `tableau/exposed-card-turns`'s, nor how
// a face is DRAWN, which is `table/*`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  everyCard,
  openTable,
  pileOf,
  poseColumn,
  requireCard,
  type CardView,
  type Harness,
} from "../harness";

/** The column the named card lies on, and its row within that column. */
const COLUMN = 1;
const NAMED_ROW = 1;

/**
 * The column the named card lies on, bottom card first, and the bystanding one.
 *
 * The named card is the middle of three and is not the column's lowest, so a
 * build turning the exposed card instead reads as a different answer. Between
 * them the five cards carry both faces before either pose is made.
 */
const COLUMN_CARDS = [
  card("9C", false),
  card("8D", false),
  card("7S", true),
] as const;
const BYSTANDER_COLUMN = 4;
const BYSTANDER_CARDS = [card("4H", false), card("3S", true)] as const;

/** Every card's face, keyed by id, as one comparable string. */
function faces(views: readonly CardView[]): string {
  return views
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((c) => `${c.id}:${c.faceUp ? "up" : "down"}`)
    .join(" ");
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sets one card's face both ways and turns no other card", async () => {
  await openTable(h);
  await poseColumn(h, COLUMN, [...COLUMN_CARDS]);
  await poseColumn(h, BYSTANDER_COLUMN, [...BYSTANDER_CARDS]);

  const posed = await h.snapshot();
  const named = pileOf(posed, "tableau", COLUMN)[NAMED_ROW];
  const others = (view: CardView): boolean => view.id !== named.id;
  const untouched = faces(everyCard(posed).filter(others));

  // Both poses are driven before anything is asserted, so a failing one still
  // leaves the picture of the board the second left.
  const read: { faceUp: boolean; named: boolean; others: string }[] = [];
  for (const faceUp of [true, false]) {
    await h.debug.setCardFaceUp(named.id, faceUp);
    // Read before a frame runs: nothing stands between the pose and the reading.
    const after = await h.snapshot();
    read.push({
      faceUp,
      named: requireCard(after, named.id, "reading back a posed face").faceUp,
      others: faces(everyCard(after).filter(others)),
    });
  }

  await h.advance(1);
  await captureStill(h, "faces");

  for (const step of read) {
    assertEqual(
      step.named,
      step.faceUp,
      `the face snapshot() reports for the card setCardFaceUp(${named.id}, ` +
        `${step.faceUp}) named, the middle card of column ${COLUMN}`,
    );
    assertEqual(
      step.others,
      untouched,
      `every other card's face after setCardFaceUp(${named.id}, ` +
        `${step.faceUp}), against the faces they were posed with — the ` +
        `operation sets ONE card's face (specs/instrumentation.md)`,
    );
  }
});
