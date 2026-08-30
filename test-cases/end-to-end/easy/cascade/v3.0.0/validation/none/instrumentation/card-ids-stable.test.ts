// instrumentation/card-ids-stable — a card keeps the id it was given while it is
// on the table, across the move that carries it home.
//
// THE RULE. `specs/instrumentation.md`, Identity: "A card keeps its id for as
// long as it is on the table, across every move, turn, flip, and recycle, and a
// card that launches keeps it as a flyer."
//
// WHY IT MATTERS. An id that is reassigned when a card changes pile is an id no
// check can follow, and following one card is exactly what several points in this
// suite do — `automove/*` reads where a card ended up, `runs/*` reads which cards
// travelled together, `tableau/*` reads which card was turned. A build that
// rebuilds its cards on every move would pass each of those only by accident, and
// its defect would surface as a card that "vanished" under a heading about a
// rule.
//
// THE MOVE IS THE SIMPLEST ONE THE RULES ACCEPT: an Ace from a column onto an
// empty foundation, which `specs/foundations.md` accepts whatever the suit. The
// card is followed by `whereIs`, which searches every pile for that id, so a
// build that reassigned it reports the card missing from the whole board rather
// than merely absent from the foundation — and the suit and rank are read back
// beside the id, so a build that kept the id and moved a different card is caught
// as well.
//
// THE MOVE'S VERDICT IS ASSERTED FIRST, because a move the build refused never
// carried the card anywhere and this point would be reading an untouched column.
//
// WHAT THIS DOES NOT DECIDE. Whether the ids are DISTINCT, which is
// `instrumentation/card-ids-distinct`'s, nor whether the foundation should have
// accepted the card, which is `foundations/accepts-ace-when-empty`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  card,
  cardKey,
  createHarness,
  openTable,
  poseColumn,
  requireCard,
  whereIs,
  type Harness,
} from "../harness";

/** The column the card starts on, and the foundation it is sent to. */
const COLUMN = 4;
const FOUNDATION = 2;

/** The card that travels: an Ace, which an empty foundation accepts. */
const TRAVELLER = "AD";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the moved card with the id it carried before the move", async () => {
  await openTable(h);
  const [id] = await poseColumn(h, COLUMN, [card(TRAVELLER)]);

  const before = requireCard(
    await h.snapshot(),
    id,
    "reading the card's identity before it moves",
  );

  const accepted = await h.debug.move(
    "tableau",
    COLUMN,
    0,
    "foundation",
    FOUNDATION,
  );
  const after = await h.snapshot();

  await h.advance(1);
  // Before the assertions, so a lost id still leaves the picture of the board
  // the move produced.
  await captureStill(h, "moved");

  assertEqual(
    accepted,
    true,
    `the verdict move() returned on sending the ${TRAVELLER} from column ` +
      `${COLUMN} to the empty foundation ${FOUNDATION}, which accepts an Ace ` +
      `of any suit (specs/foundations.md) — a refused move carries the card ` +
      `nowhere and this point would read an untouched column`,
  );

  const found = whereIs(after, id);
  assertEqual(
    found === null ? "no pile holds it" : `${found.pile} ${found.index}`,
    `foundation ${FOUNDATION}`,
    `where the card carrying id ${id} is after the move — a card keeps its id ` +
      `across every move (specs/instrumentation.md, Identity), so an id no ` +
      `pile holds means the card was rebuilt`,
  );
  assertEqual(
    cardKey(requireCard(after, id, "reading the moved card")),
    cardKey(before),
    `the card now carrying id ${id}, against the ${TRAVELLER} that carried it ` +
      `before the move`,
  );
});
