// runs/returns-intact — a refused run is back in its own column, in the order it
// lay in, with every face unchanged, and the target keeps what it held.
//
// `specs/tableau.md`, "A refused move": "A refused move changes nothing. Every card
// it carried returns to the pile it was taken from, in the order it left, with
// every face as it was, and the target keeps what it held." And, from "Turning an
// exposed card": "a lift whose move is then refused leaves the card beneath
// face-down throughout."
//
// THE POSE CARRIES A FACE-DOWN CARD ON PURPOSE. The column is a face-down card with
// a three-card run beneath it, and the run is what the move names. So the check
// reads two things a refusal must not do: it must not reorder the cards it gave
// back, and it must not turn the card the lift left exposed. A build that turns the
// face-down card on the LIFT rather than on an accepted move reads as a different
// face list here rather than being averaged away.
//
// THE REFUSAL IS UNAMBIGUOUS. The target's lowest card is a black five, which is
// neither one rank above the run's black nine nor the other color, so no reading of
// the acceptance rule lands this move. WHY a particular offer is refused is the
// business of `runs/reject-wrong-color`, `runs/reject-wrong-rank` and
// `runs/reject-broken-run`; this item is about the board a refusal leaves.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  card,
  cards,
  createHarness,
  faceDown,
  facesOf,
  openTable,
  pileOf,
  poseColumn,
  type Harness,
} from "../harness";

/** The column the run is offered from. Not column `0`, so a hard-coded one fails. */
const SOURCE = 4;

/** The column it is offered to. */
const TARGET = 1;

/**
 * The source column, first card first: a face-down three, then a three-card run in
 * descending, alternating order.
 */
const COLUMN = [...faceDown("3C"), ...cards("9S", "8H", "7S")];

/** The faces that column was posed with, which a refusal must leave exactly as they are. */
const FACES = [false, true, true, true];

/** The row the move names: the first face-up card, so the whole run is offered. */
const GRABBED_ROW = 1;

/**
 * The card waiting on the target: a black five. It is neither the rank nor the
 * color the run's black nine would need, so the refusal is beyond argument.
 */
const TARGET_CARD = card("5S");

/** One frame, so the still shows the board the refusal left. It decides nothing. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("gives a refused run back to its column in order, with its faces unchanged", async () => {
  await openTable(h);
  const [targetId] = await poseColumn(h, TARGET, [TARGET_CARD]);
  const columnIds = await poseColumn(h, SOURCE, COLUMN);

  const accepted = await h.debug.move(
    "tableau",
    SOURCE,
    GRABBED_ROW,
    "tableau",
    TARGET,
  );

  await h.advance(DRAW_FRAMES);
  await captureStill(h, "returned");
  const after = await h.snapshot();

  assertEqual(
    accepted,
    false,
    "move to report the rules' verdict on a run led by the black nine offered to " +
      `column ${TARGET}, whose lowest card is the black five — neither the rank ` +
      "nor the color the acceptance rule asks for (specs/tableau.md)",
  );

  const source = pileOf(after, "tableau", SOURCE);
  assertDeepEqual(
    source.map((c) => c.id),
    columnIds,
    `column ${SOURCE} read bottom card first after the refusal — every card the ` +
      "move carried is back where it was, in the order it left. A shorter list is " +
      "a build that applied part of the move; a reordered one is a build that gave " +
      "the run back backwards",
  );
  assertDeepEqual(
    facesOf(source),
    FACES,
    `the faces of column ${SOURCE} after the refusal — the three stays face-down, ` +
      "because only an accepted move turns a newly exposed card",
  );
  assertDeepEqual(
    pileOf(after, "tableau", TARGET).map((c) => c.id),
    [targetId],
    `column ${TARGET} after the refusal, which keeps exactly what it held`,
  );
});
