// instrumentation/card-ids-stable — a card keeps its id when it moves.
//
// THE RULE. specs/instrumentation.md, under Identity: "A card keeps its id for
// as long as it is on the table, across every move, turn, flip, and recycle,
// and a card that launches keeps it as a flyer." That is the rule that makes an
// id worth reading: a scenario notes the id of the card it cares about, drives
// the game, and finds that card again wherever the rules put it. A build that
// rebuilds a card on arrival — a fresh object with a fresh number — leaves every
// such reading following a card that no longer exists.
//
// THE MOVE IS THE PLAINEST ONE THERE IS: an Ace off a column onto an empty
// foundation, which specs/foundations.md accepts from any suit. Nothing else is
// on the table, so the card the foundation reports afterwards can only be the
// card the column gave it, and the reading is its number.
//
// THE READING NAMES THE SUIT AND RANK TOO, so a failure says whether the build
// moved the wrong card or renumbered the right one.
//
// WHAT IT DOES NOT DECIDE. That an empty foundation accepts an Ace is
// `foundations.ace-starts-empty`; that ids are distinct in the first place is
// `instrumentation/card-ids-distinct`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  ACE,
  captureStill,
  card,
  createHarness,
  openTable,
  pileOf,
  poseColumn,
  topOf,
  type Harness,
} from "../harness";

/** The card that moves: an Ace, which an empty foundation takes from any suit. */
const MOVED = card("spades", ACE);

/** The column it is lifted from, and the empty foundation it lands on. */
const COLUMN = 2;
const FOUNDATION = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports the moved card on its foundation with the id it left the column with", async () => {
  openTable(h);
  const [id] = poseColumn(h, COLUMN, [MOVED]);

  const accepted = h.debug.move("tableau", COLUMN, 0, "foundation", FOUNDATION);
  const after = h.snapshot();

  await h.advance(1);
  captureStill(h, "moved");

  assertEqual(
    accepted,
    true,
    `move() to accept the ${MOVED.suit} Ace onto empty foundation ` +
      `${FOUNDATION}: a foundation holding nothing accepts an Ace of any ` +
      "suit (specs/foundations.md)",
  );

  const arrived = topOf(pileOf(after, "foundation", FOUNDATION));
  assertDeepEqual(
    arrived === undefined
      ? null
      : { suit: arrived.suit, rank: arrived.rank, id: arrived.id },
    { suit: MOVED.suit, rank: MOVED.rank, id },
    `the card on foundation ${FOUNDATION} after the move: a card keeps its ` +
      "id for as long as it is on the table, across every move " +
      "(specs/instrumentation.md)",
  );
});
