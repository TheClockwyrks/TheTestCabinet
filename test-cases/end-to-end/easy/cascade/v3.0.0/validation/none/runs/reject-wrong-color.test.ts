// runs/reject-wrong-color — a run whose leading card is the SAME color as the
// target's lowest card is refused, however well its rank fits.
//
// `specs/tableau.md`, "What a column accepts": a column whose "lowest card is
// face-up, of rank `r` and color `c`" accepts "A run led by a card of rank `r - 1`
// and the color other than `c`", and "refuses every other run offered to it".
//
// THE DISTINGUISHING POSE. The offered run is led by the BLACK eight and the
// target's lowest card is the BLACK nine, so the rank is exactly `r - 1` and the
// color is the only thing wrong with the offer. A build that never compares colors
// accepts this move and fails here; a build that compares them refuses it. Nothing
// else about the offer can decide it, so the failure names the color rule.
//
// WHAT THIS ITEM DECIDES. The color half of the refusal, in one direction. The
// rank half is `runs/reject-wrong-rank`, the accepting direction is
// `runs/onto-legal-card`, and what becomes of the refused cards is
// `runs/returns-intact`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  card,
  cards,
  createHarness,
  openTable,
  pileOf,
  poseColumn,
  whereIs,
  type Harness,
} from "../harness";

/** The column the run is offered from. Not column `0`, so a hard-coded one fails. */
const SOURCE = 1;

/** The column it is offered to. */
const TARGET = 3;

/** The target's lowest card: a black nine, so it accepts a RED eight and nothing else. */
const TARGET_CARD = card("9S");

/**
 * The run offered: a black eight leading a red seven.
 *
 * A run in its own right, and of rank `9 - 1`, so the color is the single reason
 * the target must refuse it.
 */
const RUN = cards("8S", "7H");

/** One frame, so the still shows the board the refusal left. It decides nothing. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("refuses a run whose leading card matches the target's color", async () => {
  await openTable(h);
  const [targetId] = await poseColumn(h, TARGET, [TARGET_CARD]);
  const runIds = await poseColumn(h, SOURCE, RUN);

  const accepted = await h.debug.move("tableau", SOURCE, 0, "tableau", TARGET);

  await h.advance(DRAW_FRAMES);
  await captureStill(h, "refused");
  const after = await h.snapshot();

  assertEqual(
    accepted,
    false,
    "move to report the rules' verdict on a run led by the black eight offered " +
      `to column ${TARGET}, whose lowest card is the black nine — the rank fits ` +
      "and the color does not, and specs/tableau.md accepts only a run led by a " +
      "card of the other color",
  );
  assertDeepEqual(
    pileOf(after, "tableau", TARGET).map((c) => c.id),
    [targetId],
    `column ${TARGET} after the refusal: the black nine it already held, and ` +
      "nothing the run brought with it",
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
