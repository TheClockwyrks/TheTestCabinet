// tableau/reject-same-color — a column refuses the card below it in its own color.
//
// specs/tableau.md: a column whose lowest card is face-up, of rank `r` and color
// `c`, accepts a run led by a card of rank `r - 1` and "the color other than `c`",
// "and refuses every other run offered to it".
// specs/instrumentation.md: a refused `move` returns `false` and leaves the board
// unchanged.
//
// THE DISTINGUISHING CARD. The target's lowest card is the RED nine and the card
// offered is the RED eight: the rank the rule wants, in the color it forbids. It
// differs from the card `build-down-alternating` offers in color alone, so a build
// that checks the rank and never the color accepts it and is caught here, while a
// build that has the colors backwards fails there instead. The black eight is
// nowhere on the table, so a refusal cannot come out right by some other card going
// in its place.
//
// WHAT IS READ. The verdict, and then the whole board against the board before the
// move: a refusal that dropped the card, turned it over, or left it on the target
// anyway is not a refusal (specs/tableau.md).

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
/** One rank lower than the target's card, and the SAME color. */
const OFFERED = "8D";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a card one rank lower of the same color", async () => {
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
      `${TARGET_LOWEST}: one rank lower, and the same color ` +
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
