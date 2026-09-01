// foundations/ace-starts-empty — an empty foundation accepts an Ace, and holds it.
//
// specs/foundations.md: a foundation holding nothing accepts "an Ace, of any suit",
// and any suit may be started on any empty foundation.
// specs/instrumentation.md: `move(fromPile, fromIndex, fromRow, toPile, toIndex)`
// attempts a move and returns `true` when the game's own rules accepted it; an
// accepted move applies through the same path a released drop uses.
//
// THE POSE. One Ace alone in a column, four empty foundations, and nothing else on
// the table, so the only rule the verdict can turn on is what an empty foundation
// takes. The move names foundation 0 explicitly rather than letting the build
// choose, because this item is about the acceptance and not about which slot an Ace
// is routed to; `any-suit-any-slot` is the item that asks whether a slot other than
// the first will take one.
//
// The Ace is a DIAMOND, so a build that accepts only the first suit of its own deck
// order onto an empty foundation reads as a refusal here rather than passing on the
// spade it happened to be written against.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  pileSpecs,
  poseColumn,
  type Harness,
} from "../harness";

/** The empty foundation the Ace is offered to. */
const FOUNDATION = 0;
/** The column the Ace waits in. */
const COLUMN = 3;
/** The Ace offered. Its suit is arbitrary: an empty foundation takes any Ace. */
const ACE = "AD";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("accepts an Ace onto an empty foundation", async () => {
  openTable(h);
  poseColumn(h, COLUMN, [ACE]);

  const accepted = h.debug.move("tableau", COLUMN, 0, "foundation", FOUNDATION);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "accepted");

  assertEqual(
    accepted,
    true,
    `move of ${ACE} from column ${COLUMN} onto empty foundation ` +
      `${FOUNDATION}, which accepts an Ace of any suit ` +
      "(specs/foundations.md)",
  );
  assertDeepEqual(
    pileSpecs(after.foundations[FOUNDATION]),
    [ACE],
    `foundation ${FOUNDATION} after the move: the Ace, and it alone ` +
      "(specs/foundations.md)",
  );
  assertLength(
    after.tableau[COLUMN],
    0,
    `the cards left in column ${COLUMN}: the Ace has left it ` +
      "(specs/tableau.md)",
  );
});
