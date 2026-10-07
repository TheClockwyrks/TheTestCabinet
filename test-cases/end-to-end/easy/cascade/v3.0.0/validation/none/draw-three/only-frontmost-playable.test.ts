// draw-three/only-frontmost-playable — only the frontmost fanned card may be played.
//
// THE RULE. `specs/stock.md`: "Only the waste's top card may be played... A move
// naming any other card on the waste is refused." Under Draw Three the two cards
// behind the top one are fanned and fully visible (`specs/table.md`), which is
// exactly where a build is tempted to treat the waste like a tableau column and
// let a player take a card from the middle of it, or take the frontmost card along
// with it.
//
// THE POSE MAKES THE REFUSAL MEAN SOMETHING. The three shown cards are the seven
// of spades, the six of hearts and the five of spades, in that order, so the run
// beginning at either card behind the top — which is what a `move` naming it
// takes, by `specs/instrumentation.md` — is itself descending and
// colour-alternating, and each is offered to a column that accepts exactly that
// run (`specs/tableau.md`): the six-and-five onto a black seven, and the whole
// three onto a red eight. A build that refuses these for being runs, or for the
// target's sake, refuses nothing this point is about; only the rule that the waste
// offers its top card alone can refuse them here.
//
// EACH CARD BEHIND THE TOP IS ITS OWN READING, so a build that guards the card
// directly behind the top but not the one behind that fails with the card it let
// through named. The board is read afterwards as well: a build whose `move`
// reports a refusal and moves the cards anyway has not refused anything.
//
// THE TOP CARD'S OWN PLAYABILITY IS NOT DECIDED HERE. That is the common
// `stock.waste-top-to-tableau`, and asserting it too would grade one requirement
// in two directions.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  card,
  cardKey,
  cards,
  captureStill,
  createHarness,
  openTable,
  poseColumn,
  poseWaste,
  type Harness,
} from "../harness";

/** The three cards of the shown set, bottom first, so the five of spades is on top. */
const SHOWN = ["7S", "6H", "5S"];

/** One set holding all three, so all three are fanned and visible. */
const SETS = [SHOWN.length];

/**
 * The two columns the refused moves are offered to. Each accepts the run the move
 * names, so nothing but the waste's own rule can refuse it (`specs/tableau.md`).
 */
const COLUMNS = [
  { index: 0, cards: ["7C"] },
  { index: 1, cards: ["8H"] },
];

/**
 * The moves that must be refused: the card named by its row within the waste,
 * counted from the bottom, and the column that would accept it were it playable.
 */
const REFUSED = [
  { row: 1, card: "6H", column: 0, target: "7C" },
  { row: 0, card: "7S", column: 1, target: "8H" },
];

/** One frame, so the still carries the board the refusals left. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses both of the cards behind the fan's frontmost", async () => {
  await openTable(h);
  for (const column of COLUMNS)
    await poseColumn(h, column.index, cards(...column.cards));
  await poseWaste(h, cards(...SHOWN), SETS);

  const verdicts: boolean[] = [];
  for (const attempt of REFUSED) {
    verdicts.push(
      await h.debug.move("waste", 0, attempt.row, "tableau", attempt.column),
    );
  }
  const after = await h.snapshot();
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "refused");

  for (const [index, attempt] of REFUSED.entries()) {
    assertEqual(
      verdicts[index],
      false,
      `the verdict on moving the ${attempt.card}, which the fan shows behind ` +
        `the top card, onto the ${attempt.target}: only the waste's top card ` +
        "may be played (specs/stock.md)",
    );
  }

  assertDeepEqual(
    after.waste.map(cardKey),
    SHOWN.map((text) => cardKey(card(text))),
    "the cards on the waste after both refusals, bottom first: a refused move " +
      "leaves the board unchanged (specs/instrumentation.md)",
  );
});
