// handling/release-on-illegal-returns — a release over a pile that refuses the run
// puts the run back where it came from.
//
// specs/controls.md: a drop whose leading card's center lies "in the rectangle of a
// pile that refuses the run" has "the run returns to the pile it was lifted from".
// specs/tableau.md fixes what returning means: "Every card it carried returns to the
// pile it was taken from, IN THE ORDER IT LEFT, with every face as it was, and the
// target keeps what it held."
//
// THE RUN IS TWO CARDS, so the order half of the rule is decidable: a build that
// returns the run reversed, or that returns only its leading card, reads a different
// column from the one the specification owes. The two are in run order — the black
// six and the red five beneath it (specs/tableau.md) — so the only reason the target
// refuses them is the target itself.
//
// THE REFUSAL IS BY RANK. The target column's lowest card is the red six, and a
// column accepts a run led by a card one rank LOWER than it (specs/tableau.md), so a
// run led by a six is refused whatever its color. A build that compares only colors
// lands the run and fails here.
//
// THE PRESS LANDS ON THE STRIP THE GRABBED CARD LEAVES UNCOVERED, because the card
// pressed is not its column's lowest and a press resolves to "the lowest of the
// cards whose footprint contains that point" (specs/controls.md); the release is
// then aimed so the leading card's center lands on the target rectangle's center,
// which is what `aim.ts` computes from the offset the press made.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNull } from "../assert";
import {
  captureStill,
  cardTopLeft,
  createHarness,
  drag,
  openTable,
  pileSpecs,
  poseColumn,
  releasePoint,
  type Harness,
} from "../harness";
import { exposedPressPoint, releaseForCenter } from "./aim";

/** The column the run is lifted from, and the run, bottom card last. */
const FROM_COLUMN = 0;
const RUN = ["6S", "5H"];

/** The row the press grabs: the top of the two, so both cards are lifted. */
const GRABBED_ROW = 0;

/** The column it is released over, and its lowest card: a six, so it refuses. */
const OVER_COLUMN = 3;
const REFUSING = "6H";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns the whole run to its source column, in order, over a pile that refuses it", async () => {
  openTable(h);
  poseColumn(h, FROM_COLUMN, RUN);
  poseColumn(h, OVER_COLUMN, [REFUSING]);

  const press = exposedPressPoint(h.snapshot(), FROM_COLUMN, GRABBED_ROW);
  const lead = cardTopLeft(h.snapshot(), "tableau", FROM_COLUMN, GRABBED_ROW);
  const release = releaseForCenter(
    releasePoint(h.snapshot(), "tableau", OVER_COLUMN),
    press,
    lead,
  );
  drag(h, press, release);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "returned");

  assertDeepEqual(
    pileSpecs(after.tableau[FROM_COLUMN]),
    RUN,
    `column ${FROM_COLUMN} after the refused drop: every card returns to the ` +
      "pile it was taken from, in the order it left (specs/tableau.md)",
  );
  assertDeepEqual(
    pileSpecs(after.tableau[OVER_COLUMN]),
    [REFUSING],
    `column ${OVER_COLUMN} after the refused drop: the target keeps what it ` +
      "held (specs/tableau.md)",
  );
  assertNull(
    after.drag,
    "the hand after the release: the gesture ended, whether the target took " +
      "the run or refused it (specs/controls.md)",
  );
});
