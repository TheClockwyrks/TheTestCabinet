// stock/only-top-playable — a move naming a card on the waste that is not its
// top card is refused, and the board is left exactly as it was.
//
// `specs/stock.md`: "Only the waste's top card may be played ... A move naming
// any other card on the waste is refused." `specs/controls.md` says the same of
// the gesture: a press on "a card on the waste that is not its top card" lifts
// nothing. `move` names a card on a pile by its row, counted from the bottom
// (`specs/instrumentation.md`), so this point names the card BELOW the top one
// and holds the game to refusing it.
//
// THE TARGET WOULD TAKE THE CARD IF THE WASTE OFFERED IT, which is what makes
// the refusal decide THIS rule rather than the target's. Column 6 shows the
// Queen of spades, and the card this move names is the Jack of hearts: one rank
// lower and the opposite colour, which `specs/tableau.md` accepts. So a build
// that let a buried waste card be played reads as an ACCEPTED move here —
// whether it carried that card alone or carried it with the card above it, since
// the Jack of hearts over the ten of spades is a run in order and the column
// takes a run led by the Jack either way.
//
// EVERY OTHER READING IS THE BOARD BEING UNCHANGED. `specs/tableau.md`: "A
// refused move changes nothing." The waste keeps both cards in their order, its
// set memory is untouched, and the column still holds its Queen alone.
//
// THE MEMORY IS SIZED TO THE BUILD'S OWN TURN COUNT, counted back from the
// waste's top card, so the board is one the build's own turns could have
// reached, and the named card is below the top under either mode.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  cards,
  createHarness,
  openTable,
  pileOf,
  poseColumn,
  poseWaste,
  type Harness,
} from "../harness";
import { keysOf, turnCount, turnSets } from "./turns";

/** The column the refused move names, showing a card the Jack would fit onto. */
const COLUMN = 6;
const COLUMN_CARDS = ["QS"];

/** The waste, bottom card first: the named card, and the top card above it. */
const WASTE = ["JH", "10S"];

/** The row the move names: the card below the waste's top card. */
const BURIED_ROW = 0;

/** One frame, so the still carries the waste the refusal left standing. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("refuses a move naming a waste card below the top one", async () => {
  await openTable(h);
  const count = turnCount(await h.snapshot());
  const posedSets = turnSets(WASTE.length, count);
  await poseColumn(h, COLUMN, cards(...COLUMN_CARDS));
  await poseWaste(h, cards(...WASTE), posedSets);

  const played = await h.debug.move("waste", 0, BURIED_ROW, "tableau", COLUMN);
  await h.advance(DRAW_FRAMES);
  await captureStill(h, "refused");

  assertEqual(
    played,
    false,
    `move's verdict on the ${WASTE[BURIED_ROW]}, which lies below the ` +
      "waste's top card — specs/stock.md: only the waste's top card may be " +
      "played, and a move naming any other card on the waste is refused. The " +
      `column would accept that card from a pile that offered it, so a ` +
      "verdict of true is the waste's rule broken rather than the column's",
  );

  const after = await h.snapshot();
  assertDeepEqual(
    keysOf(after.waste),
    keysOf(cards(...WASTE)),
    "the cards on the waste after the refused move, bottom card first — " +
      "specs/tableau.md: a refused move changes nothing",
  );
  assertDeepEqual(
    after.wasteSets,
    posedSets,
    "the waste's set memory after the refused move, oldest set first — a " +
      "move that never happened takes nothing off any set (specs/stock.md)",
  );
  assertDeepEqual(
    keysOf(pileOf(after, "tableau", COLUMN)),
    keysOf(cards(...COLUMN_CARDS)),
    `the cards in column ${COLUMN} after the refused move — the target keeps ` +
      "what it held (specs/tableau.md)",
  );
});
