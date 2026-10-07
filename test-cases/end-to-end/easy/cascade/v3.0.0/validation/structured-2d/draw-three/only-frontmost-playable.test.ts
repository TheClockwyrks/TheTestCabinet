// Cascade — draw-three/only-frontmost-playable: the two cards behind the frontmost are not playable.
//
// specs/stock.md, Playing off the waste: "Only the waste's top card may be
// played ... A move naming any other card on the waste is refused."
//
// In Draw One that rule only ever refuses a card the player cannot see. Draw
// Three is where it bites: the two cards behind the frontmost are FANNED and
// fully visible (specs/table.md), so a build that resolves a move to whichever
// fanned card was named plays a card the rules do not offer. That is the fault
// this point exists to catch, and it is why it is separate from the common
// `stock.only-top-playable`, whose refused card is buried out of sight.
//
// A REFUSAL ONLY MEANS SOMETHING WHERE AN ACCEPTANCE WAS AVAILABLE. A move out of
// a pile takes the named card "and every card the pile holds after it" as one run
// (specs/instrumentation.md), so naming a card behind the frontmost names a run
// of two or three — and every foundation refuses a run of more than one whatever
// its source (specs/foundations.md). A scenario that offered these moves to a
// foundation would therefore be refused by a build with no waste rule at all, and
// would decide nothing.
//
// So the shown set is itself a RUN — the six of hearts, the five of spades and
// the four of hearts, descending and alternating in colour (specs/tableau.md) —
// and two columns are posed that would accept it:
//
//   column 0, its lowest card the seven of spades   accepts the run led by  ♥6
//   column 1, its lowest card the six of diamonds   accepts the run led by  ♠5
//
// "A column accepts a run from another column, FROM THE WASTE, and from a
// foundation, on exactly the terms above" (specs/tableau.md), so each of these
// two moves is legal in every respect but one: the card it names is not the
// waste's top card. A build that has dropped that one rule makes both moves.
//
// One direction only: that the FRONTMOST card IS playable is
// `stock.waste-top-to-foundation`'s and `stock.waste-top-to-tableau`'s, so a
// build that refuses everything is failed there rather than twice here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  FIVE,
  FOUR,
  SEVEN,
  SIX,
  captureStill,
  card,
  cardsHome,
  createHarness,
  openTable,
  poseColumn,
  poseWaste,
  type Harness,
} from "../harness";

/**
 * The shown set, bottom first, under one set of three.
 *
 * A run in its own right, so the two cards behind the frontmost are refused for
 * being behind it rather than for being an ill-formed run.
 */
const SHOWN = [card("hearts", SIX), card("spades", FIVE), card("hearts", FOUR)];
const SETS = [SHOWN.length];

/**
 * The two moves offered, each naming a card behind the frontmost and a column
 * that accepts the run that card leads (specs/tableau.md).
 */
const OFFERED = [
  { row: 0, column: 0, exposed: card("spades", SEVEN) },
  { row: 1, column: 1, exposed: card("diamonds", SIX) },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a move naming either of the two cards fanned behind the frontmost", async () => {
  openTable(h);
  poseWaste(h, SHOWN, SETS);
  for (const offer of OFFERED) poseColumn(h, offer.column, [offer.exposed]);

  const verdicts = OFFERED.map((offer) =>
    h.debug.move("waste", 0, offer.row, "tableau", offer.column),
  );

  await h.drawFrame();
  captureStill(h, "refused");

  OFFERED.forEach((offer, which) => {
    assertEqual(
      verdicts[which],
      false,
      `move() to refuse the ${SHOWN[offer.row].suit} ` +
        `${SHOWN[offer.row].rank}, fanned behind the frontmost card, offered ` +
        `to the column its run would otherwise land on (specs/stock.md)`,
    );
  });

  // "A refused move changes nothing" (specs/tableau.md): every card is where it
  // was posed.
  const after = h.snapshot();
  assertEqual(after.waste.length, SHOWN.length, "cards left on the waste");
  for (const offer of OFFERED) {
    assertEqual(
      after.tableau[offer.column].length,
      1,
      `cards on column ${offer.column}, which the refused run did not land on`,
    );
  }
  assertEqual(cardsHome(after), 0, "cards on the foundations");
});
