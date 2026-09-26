// runs/reject-wrong-rank — a run whose leading card is not one rank below the
// target's lowest card is refused, however well its color alternates.
//
// `specs/tableau.md`, "What a column accepts": a column whose "lowest card is
// face-up, of rank `r` and color `c`" accepts "A run led by a card of rank `r - 1`
// and the color other than `c`", and "refuses every other run offered to it".
//
// THE DISTINGUISHING POSE. The offered run is led by the RED seven and the
// target's lowest card is the BLACK nine, so the color is exactly the one the rule
// asks for and the rank is two lower rather than one. That is the offer that
// separates the rule from the wrong model nearest to it — a build that accepts any
// LOWER card of the opposite color — and a build reading the rank as `r - 1`
// refuses it. A leading card of the same color would have let both models refuse
// and decided nothing.
//
// WHAT THIS ITEM DECIDES. The rank half of the refusal, in one direction. The
// color half is `runs/reject-wrong-color`, the accepting direction is
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

/** The target's lowest card: a black nine, so it accepts a red EIGHT and nothing else. */
const TARGET_CARD = card("9S");

/**
 * The run offered: a red seven leading a black six.
 *
 * A run in its own right, and of the color the target's black nine asks for, so
 * the rank is the single reason the target must refuse it.
 */
const RUN = cards("7H", "6S");

/** One frame, so the still shows the board the refusal left. It decides nothing. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("refuses a run whose leading card is two ranks below the target", async () => {
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
    "move to report the rules' verdict on a run led by the red seven offered to " +
      `column ${TARGET}, whose lowest card is the black nine — the color fits and ` +
      "the rank is two lower, and specs/tableau.md accepts only a run led by a " +
      "card of rank r - 1",
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
