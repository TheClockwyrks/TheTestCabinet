// runs/reject-non-king-run-empty — an empty column refuses a run that is not led
// by a King.
//
// `specs/tableau.md`, "What a column accepts": a column that is "Empty" accepts "A
// run led by a King", and "refuses every other run offered to it". Nothing lower
// may open an empty column.
//
// THE DISTINGUISHING POSE. The run offered is a proper run — a red ten leading a
// black nine, descending and alternating — so its order is beyond question and the
// rank of its LEADING card is the only thing that can decide the move. A build that
// lets any run into an empty column accepts this and fails here; a build that reads
// the King rule refuses it. A ten rather than a queen or a jack, so a build that
// admits face cards is caught by the same offer.
//
// WHAT THIS ITEM DECIDES. The refusing direction of the empty-column rule; the
// accepting direction is `runs/king-run-to-empty`. That the refused cards are back
// in their own column, in order, is `runs/returns-intact`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  cards,
  createHarness,
  openTable,
  pileOf,
  poseColumn,
  whereIs,
  type Harness,
} from "../harness";

/** The column the run is offered from. Not column `0`, so a hard-coded one fails. */
const SOURCE = 2;

/** The column it is offered to. `openTable` leaves it holding nothing. */
const TARGET = 5;

/** The run: a red ten leading a black nine. A run in order, and not led by a King. */
const RUN = cards("10D", "9S");

/** One frame, so the still shows the board the refusal left. It decides nothing. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("keeps a run not led by a King out of an empty column", async () => {
  await openTable(h);
  const runIds = await poseColumn(h, SOURCE, RUN);

  const accepted = await h.debug.move("tableau", SOURCE, 0, "tableau", TARGET);

  await h.advance(DRAW_FRAMES);
  await captureStill(h, "refused");
  const after = await h.snapshot();

  assertEqual(
    accepted,
    false,
    `move to report the rules' verdict on a run led by the red ten offered to the ` +
      `empty column ${TARGET} — specs/tableau.md lets an empty column take a run ` +
      "led by a King and nothing else",
  );
  assertLength(
    pileOf(after, "tableau", TARGET),
    0,
    `the cards in column ${TARGET} after the refusal, which is still the empty ` +
      "column it was",
  );
  const leadAt = whereIs(after, runIds[0]);
  assertDeepEqual(
    { pile: leadAt?.pile, index: leadAt?.index },
    { pile: "tableau", index: SOURCE },
    "which pile the run's leading card is in after the refusal — the move was " +
      "not applied, so it is still in the column it was offered from. WHERE in " +
      "that column every refused card lies is `runs/returns-intact`, so this " +
      "reading names the pile alone",
  );
});
