// instrumentation/set-card-face-up — `setCardFaceUp(id, true)` turns the
// one card its id names face-up, and turns no other card.
//
// THE RULE. `specs/instrumentation.md`: `setCardFaceUp(id, faceUp)` "Sets one
// card's face."
//
// THE TWO DIRECTIONS ARE TWO POINTS, because they are different builds: one whose
// operation only ever turns a card down passes the other point and fails this
// one, and a build that toggles rather than setting passes whichever direction
// happens to agree with the face the card already had. So the named card is posed
// at the OPPOSITE face first and then set to the face this point is about, and a
// toggle and a set read the same only by accident.
//
// `instrumentation/set-card-face-down` is the other half.
//
// AND EVERY OTHER CARD IS READ. The plausible defect is not that the operation
// does nothing but that it does too much — turning the whole column, turning
// every card of that rank, or turning the pile's lowest card instead of the one
// named — so the board carries four other cards with both faces between them, on
// two different columns, and each is held to the face it was posed with.
//
// THE CARD NAMED IS IN THE MIDDLE OF ITS COLUMN AND IS NOT THE LOWEST, so a build
// that turns "the column's exposed card" rather than the card named reads as a
// different answer, and so the automatic flip `specs/tableau.md` states — which
// belongs to an accepted move, and no move is made here — cannot be confused with
// the pose.
//
// WHAT THIS DOES NOT DECIDE. The automatic flip itself, which is
// `instrumentation/auto-flip-gate-off`'s, `instrumentation/auto-flip-gate-on`'s
// and `tableau/exposed-card-turns`'s, nor how a face is DRAWN, which is
// `table/*`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  cardOf,
  createHarness,
  openTable,
  pileOf,
  poseColumn,
  tableCards,
  type CardSnapshot,
  type Harness,
} from "../harness";

/** The column the named card lies on, and its row within that column. */
const COLUMN = 1;
const NAMED_ROW = 1;

/**
 * The column the named card lies on, bottom card first, and the bystanding one.
 *
 * The named card is the middle of three and is not the column's lowest, so a
 * build turning the exposed card instead reads as a different answer. It is posed
 * at the opposite face to the one this point sets, and between them the five
 * cards carry both faces before the pose is made.
 */
const COLUMN_CARDS = ["#9C", "#8D", "7S"] as const;
const BYSTANDER_COLUMN = 4;
const BYSTANDER_CARDS = ["#4H", "3S"] as const;

/** Every card's face, keyed by id, as one comparable string. */
function faces(views: readonly CardSnapshot[]): string {
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

afterEach(() => {
  h?.dispose();
});

it("sets the named card face-up and turns no other card", async () => {
  openTable(h);
  await poseColumn(h, COLUMN, [...COLUMN_CARDS]);
  await poseColumn(h, BYSTANDER_COLUMN, [...BYSTANDER_CARDS]);

  const posed = h.snapshot();
  const named = pileOf(posed, "tableau", COLUMN)[NAMED_ROW];
  const others = (view: CardSnapshot): boolean => view.id !== named.id;
  const untouched = faces(tableCards(posed).filter(others));

  h.debug.setCardFaceUp(named.id, true);
  // Read before a frame runs: nothing stands between the pose and the reading.
  const after = h.snapshot();

  await h.advance(1);
  // Before the assertions, so a failing pose still leaves the picture of the
  // board it was applied to.
  captureStill(h, "face-up");

  assertEqual(
    cardOf(after, named.id).faceUp,
    true,
    `the face snapshot() reports for the card setCardFaceUp(${named.id}, ` +
      `true) named, the middle card of column ${COLUMN}, posed ` +
      `face-down`,
  );
  assertEqual(
    faces(tableCards(after).filter(others)),
    untouched,
    `every other card's face after setCardFaceUp(${named.id}, ` +
      `true), against the faces they were posed with — the ` +
      `operation sets ONE card's face (specs/instrumentation.md)`,
  );
});
