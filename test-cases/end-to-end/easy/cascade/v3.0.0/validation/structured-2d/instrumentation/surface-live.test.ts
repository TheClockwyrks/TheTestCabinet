// instrumentation/surface-live — the surface is wired to the running game rather
// than to a plausible-looking object beside it.
//
// THE RULE. specs/instrumentation.md makes the surface a deliverable: "Every
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
// THE SURFACE IS DRIVEN BOTH WAYS ROUND: a POSE is read back, and an EVENT is
// applied by the game's own rules.
//
// WHAT THIS DOES NOT DECIDE. Not what any particular operation means — every one
// of them has its own point in this group — and not the rule the move leans on,
// which belongs to `foundations/*` or `tableau/*`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  EIGHT,
  NINE,
  openTable,
  pileOf,
  poseColumn,
  topOf,
  type Harness,
} from "../harness";

/** The column the run is lifted from, and the one it lands on. */
const SOURCE_COLUMN = 1;
const TARGET_COLUMN = 0;

/** The card posed on the target column: a red nine, which takes a black eight. */
const TARGET_CARD = card("hearts", NINE);

/** The card posed on the source column, and moved. */
const MOVED_CARD = card("spades", EIGHT);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("is live: a posed card reads back and a posed move applies", async () => {
  openTable(h);

  // The pose reads back. `poseCard` reads the id off the pile the card was
  // appended to, so a build whose `addCard` added nothing fails here already;
  // the readings below name the card that arrived.
  poseColumn(h, TARGET_COLUMN, [TARGET_CARD]);
  const [movedId] = poseColumn(h, SOURCE_COLUMN, [MOVED_CARD]);
  const posed = h.snapshot();
  assertLength(
    pileOf(posed, "tableau", TARGET_COLUMN),
    1,
    `cards on column ${TARGET_COLUMN} after one addCard (specs/instrumentation.md)`,
  );
  assertEqual(
    topOf(pileOf(posed, "tableau", TARGET_COLUMN))?.rank,
    TARGET_CARD.rank,
    "the rank the snapshot reports for the posed card",
  );

  // The pose is a real arrangement, so the game's own move rules run from it:
  // a black eight onto a red nine (specs/tableau.md).
  const accepted = h.debug.move(
    "tableau",
    SOURCE_COLUMN,
    0,
    "tableau",
    TARGET_COLUMN,
  );
  const after = h.snapshot();

  await h.advance(1);
  captureStill(h, "live");

  assertEqual(
    accepted,
    true,
    `move() to accept the ${MOVED_CARD.suit} eight onto the ` +
      `${TARGET_CARD.suit} nine, one rank lower and the other colour ` +
      "(specs/tableau.md)",
  );
  assertEqual(
    topOf(pileOf(after, "tableau", TARGET_COLUMN))?.id,
    movedId,
    `the card lowest on column ${TARGET_COLUMN} once the move was applied, ` +
      "which is the card the move carried (specs/tableau.md)",
  );
  assertLength(
    pileOf(after, "tableau", SOURCE_COLUMN),
    0,
    `cards left on column ${SOURCE_COLUMN}, which the accepted move emptied ` +
      "(specs/tableau.md)",
  );
});
