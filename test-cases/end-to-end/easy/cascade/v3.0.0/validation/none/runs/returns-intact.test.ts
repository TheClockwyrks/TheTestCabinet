// runs/returns-intact — a refused run is back in its own column, in the order it
// lay in, with every face unchanged, and the target keeps what it held.
//
// `specs/tableau.md`, "A refused move": "A refused move changes nothing. Every card
// it carried returns to the pile it was taken from, in the order it left, with
// every face as it was, and the target keeps what it held." And, from "Turning an
// exposed card": "a lift whose move is then refused leaves the card beneath
// face-down throughout."
//
// THE RUN IS CARRIED BY THE POINTER, NOT BY `move()`, AND THAT IS THE WHOLE OF
// WHAT MAKES THIS ITEM DECIDE ANYTHING. A build is free to answer `move()` by
// consulting the rules and refusing before it has picked anything up, and the
// reference does exactly that: on that path nothing is ever detached, so nothing
// is ever given back, and a check driven through `move()` would read an untouched
// column off a build whose refused DROP scrambles the run it hands back. The
// pointer path has no such escape — `specs/controls.md` has the press lift the run
// into the hand and the release resolve it — so the cards really do leave the
// column and really are returned, and this reading is of the return. Both
// engine-backed suites drive this item the same way.
//
// THE POSE CARRIES A FACE-DOWN CARD ON PURPOSE. The column is a face-down card with
// a three-card run beneath it, and the press takes the run. So the check reads two
// things a refusal must not do: it must not reorder the cards it gave back, and it
// must not turn the card the lift left exposed. A build that turns the face-down
// card on the LIFT rather than on an accepted move reads as a different face list
// here rather than being averaged away.
//
// THE REFUSAL IS UNAMBIGUOUS. The target's lowest card is a black five, which is
// neither one rank above the run's black nine nor the other color, so no reading of
// the acceptance rule lands this move, and the target keeping exactly the one card
// it held is how the refusal itself is read. WHY a particular offer is refused is
// the business of `runs/reject-wrong-color`, `runs/reject-wrong-rank` and
// `runs/reject-broken-run`; this item is about the board a refusal leaves.
//
// WHAT ITS SIBLING DECIDES INSTEAD. `handling/release-on-illegal-returns` drives
// the same gesture over a column of face-up cards and reads the return; here the
// column beneath the run is face-DOWN, which is the half of the sentence about
// faces that no other item states.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  captureStill,
  card,
  cards,
  columnCardTops,
  createHarness,
  dragRunTo,
  dropRect,
  faceDown,
  facesOf,
  openTable,
  pileOf,
  poseColumn,
  rectCenter,
  type Harness,
} from "../harness";
import { CARD_W, COLUMN_X } from "../constants";

/** The column the run is lifted from. Not column `0`, so a hard-coded one fails. */
const SOURCE = 4;

/** The column it is released over. */
const TARGET = 1;

/**
 * The source column, first card first: a face-down three, then a three-card run in
 * descending, alternating order.
 */
const COLUMN = [...faceDown("3C"), ...cards("9S", "8H", "7S")];

/** The faces that column was posed with, which a refusal must leave exactly as they are. */
const FACES = [false, true, true, true];

/** The row the press takes: the first face-up card, so the whole run is lifted. */
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

  // The press lands on the band the card below it leaves visible, so it takes the
  // run's heading card and every card beneath it, and nothing above.
  const tops = columnCardTops(FACES);
  const pressX = COLUMN_X[SOURCE] + CARD_W / 2;
  const pressY = (tops[GRABBED_ROW] + tops[GRABBED_ROW + 1]) / 2;
  const landing = rectCenter(dropRect("tableau", TARGET, [true]));

  await dragRunTo(h, pressX, pressY, landing.x, landing.y);

  await h.advance(DRAW_FRAMES);
  await captureStill(h, "returned");
  const after = await h.snapshot();

  const source = pileOf(after, "tableau", SOURCE);
  assertDeepEqual(
    source.map((c) => c.id),
    columnIds,
    `column ${SOURCE} read bottom card first after the refused release — every ` +
      "card the drop carried is back where it was, in the order it left. A " +
      "shorter list is a build that applied part of the move; a reordered one " +
      "is a build that gave the run back backwards (specs/tableau.md)",
  );
  assertDeepEqual(
    facesOf(source),
    FACES,
    `the faces of column ${SOURCE} after the refusal — the three stays ` +
      "face-down, because only an accepted move turns a newly exposed card " +
      "(specs/tableau.md)",
  );
  assertDeepEqual(
    pileOf(after, "tableau", TARGET).map((c) => c.id),
    [targetId],
    `column ${TARGET} after the refusal, which keeps exactly the black five it ` +
      "held — a target that gained a card was never a refusal at all " +
      "(specs/tableau.md)",
  );
});
