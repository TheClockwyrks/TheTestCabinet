// tableau/reject-rank-higher — a column refuses the card above it, however its color
// falls.
//
// specs/tableau.md: a column whose lowest card is face-up, of rank `r` and color
// `c`, accepts a run led by a card of rank `r - 1` and the color other than `c`, and
// "refuses every other run offered to it". A column builds DOWN, so the card one
// rank ABOVE its lowest is refused even in the alternating color.
// specs/instrumentation.md: a refused `move` returns `false` and leaves the board
// unchanged.
//
// THE DISTINGUISHING CARD. The target's lowest card is the red nine and the card
// offered is the BLACK TEN: the color the rule wants, one rank the wrong way. A
// build that compares the two ranks by their distance rather than by their order —
// `Math.abs(r - offered) === 1`, the commonest form of this mistake — accepts it,
// and nothing else in this group would catch that: `build-down-alternating` offers
// the eight that such a build also accepts. A build that has the rank comparison
// wholly backwards fails here and there both.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  poseColumn,
  type Harness,
} from "../harness";
import { boardSpecs } from "./board";

/** The column the card is offered to, holding one face-up card. */
const TARGET = 2;
/** Its lowest card: rank nine, red. */
const TARGET_LOWEST = "9H";
/** The column the offered card waits alone in. */
const SOURCE = 5;
/** One rank HIGHER than the target's card, in the alternating color. */
const OFFERED = "10S";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a card one rank higher, though its color alternates", async () => {
  openTable(h);
  poseColumn(h, TARGET, [TARGET_LOWEST]);
  poseColumn(h, SOURCE, [OFFERED]);
  const before = boardSpecs(h.snapshot());

  const accepted = h.debug.move("tableau", SOURCE, 0, "tableau", TARGET);
  const after = boardSpecs(h.snapshot());
  await h.advance(1);
  captureStill(h, "refused");

  assertEqual(
    accepted,
    false,
    `move of ${OFFERED} onto column ${TARGET}, whose lowest card is ` +
      `${TARGET_LOWEST}: one rank higher, and a column builds down ` +
      "(specs/tableau.md)",
  );
  assertDeepEqual(
    after,
    before,
    "the board after the refused move: the offered card is still alone in " +
      "its own column and the target still holds one card " +
      "(specs/tableau.md)",
  );
});
