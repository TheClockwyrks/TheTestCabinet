// presentation/drop-highlight-visible — a highlighted target reads as highlighted.
//
// THE RULE. `specs/overview.md`'s legibility table, the row "The drop target":
// "A legal drop target under a held run reads apart from the same pile drawn
// without the highlight." `specs/controls.md` is where the highlight itself is
// required: while a run is held, the pile that would accept it is the drop
// target and is drawn as highlighted. Without it a player aiming a run cannot
// tell a legal release from an illegal one until it has been made.
//
// WHAT IT DECIDES. That the highlight is DRAWN: that the same pile, drawn with a
// legal run over it and drawn with that run elsewhere, differs somewhere a player
// can see. How loudly it reads is the reviewer's. Which pile a release resolves
// to, and whether `dropTarget` names it, are the `handling` group's.
//
// WHERE IT LOOKS, AND WHY NOT AT THE WHOLE RECTANGLE. The held run is drawn over
// the piles it passes (specs/overview.md), so the part of the target's rectangle
// under the run carries the run's own pixels and can say nothing about the pile.
// The run is therefore placed so its leading card's CENTRE falls inside the
// target's rectangle — which is what specs/controls.md resolves a release by —
// while the card itself covers only part of it, and the reading is taken over
// the cells of that rectangle the run does not cover. A highlight hidden
// entirely beneath the run is a highlight a player never sees, which is the
// wrong model this placement names.
//
// THE COMPARISON HOLDS EVERYTHING ELSE STILL. A run is in hand in BOTH frames,
// lifted from the same column and holding the same card; the only difference is
// where it is, and so whether the target is legal beneath it. So nothing a build
// draws differently merely because a drag is in progress can be mistaken for the
// highlight.
//
// THE TARGET IS LEGAL BY specs/tableau.md: a column builds down in rank and
// alternates in colour, so a red seven is legal on a black eight. That the game
// agrees is asserted through `dropTarget` before the reading is taken, and that
// the run away from it names no target is asserted too.
//
// THE WORLD IT POSES. `openTable` empties all thirteen piles; a black eight goes
// on column `0` and a red seven on column `4`. Nothing else is on the table, and
// the pointer is driven through the debug surface, which
// specs/instrumentation.md feeds into the same input path a player's pointer
// feeds.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertGreaterThan,
  assertNull,
  fail,
} from "../assert";
import { CARD_H, CARD_W, COLUMN_X, TABLEAU_Y, TOP_ROW_Y } from "../constants";
import {
  captureStill,
  cardCenter,
  cards,
  createHarness,
  dropRect,
  facesOf,
  openTable,
  pileOf,
  poseColumn,
  type Harness,
} from "../harness";
import { placeRun } from "./held";
import { cellsOutside, maxDistance, sampleUnitGrid, unitGrid } from "./reading";

/** The card the run is offered to, and the card offered. */
const TARGET_CARD = "8S";
const HELD_CARD = "7H";

/** The column the target sits on, and the column the run is lifted from. */
const TARGET_COLUMN = 0;
const SOURCE_COLUMN = 4;

/**
 * Where the run is held while the target is legal beneath it.
 *
 * Its leading card's centre lands at `(319, 315)`, inside the target column's
 * drop rectangle — `CARD_W` wide at `COLUMN_X[0]`, from `TABLEAU_Y` to the
 * bottom edge of its one card, so `(224, 180)` to `(324, 320)` (specs/table.md)
 * — with five units to spare on both edges, so nothing here rests on how a build
 * rounds a boundary. The card itself covers the rectangle's lower right, leaving
 * its upper left in plain view.
 */
const OVER_X = COLUMN_X[TARGET_COLUMN] + 45;
const OVER_Y = TABLEAU_Y + 65;

/**
 * Where the run is held while no target is legal beneath it: the third column
 * position in the top row, which specs/table.md leaves carrying no pile, over an
 * empty waste that draws no fan across it.
 */
const AWAY_X = COLUMN_X[2];
const AWAY_Y = TOP_ROW_Y;

/**
 * How far outside the held card's own footprint a cell must lie to be read as
 * the pile rather than as the run, in logical units.
 *
 * Room for the edge a build finishes its cards with — an outer stroke, a soft
 * shadow — so nothing the RUN draws is counted as the pile's highlight. It is
 * small next to the tens of units of rectangle left in view.
 */
const RUN_CLEARANCE = 4;

/*
 * The reading itself: the same pile, drawn once as the drop target and once not,
 * has to differ SOMEWHERE a player can still see.
 *
 * Nothing is measured beyond that. `specs/overview.md` requires a legal drop
 * target under a held run to read apart from the same pile drawn without the
 * highlight, and it fixes no colour, no form and no coverage: a wash, an outline,
 * a glow and a brightened card are all honest, and how loudly any of them reads
 * is the reviewer's. Rendering is deterministic here — the same drawing
 * operations produce the same buffer, and the run stays in hand across both
 * frames — so a build that drew no highlight paints the two frames identically at
 * every point, and any difference at all is the highlight.
 *
 * The distance is taken at a POINT rather than over the whole rectangle, because
 * an outline lands on a few cells of a pile it surrounds, and the rectangle is
 * sampled to the unit rather than on a coarser grid that could step over a
 * one-unit outline entirely (`presentation/reading.ts`, {@link unitGrid}).
 */

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws a legal drop target apart from the same pile unhighlighted", async () => {
  await openTable(h);
  await poseColumn(h, TARGET_COLUMN, cards(TARGET_CARD));
  await poseColumn(h, SOURCE_COLUMN, cards(HELD_CARD));

  // The rectangle the target answers a release in (specs/table.md), read while
  // the column holds exactly the card posed onto it.
  const posed = await h.snapshot();
  const rect = dropRect(
    "tableau",
    TARGET_COLUMN,
    facesOf(pileOf(posed, "tableau", TARGET_COLUMN)),
  );
  const grid = unitGrid(rect);
  // The cells of that rectangle the held card does not cover, which are the only
  // ones a highlight can be read in.
  const visible = cellsOutside(grid.rect, grid.cols, grid.rows, {
    x: OVER_X - RUN_CLEARANCE,
    y: OVER_Y - RUN_CLEARANCE,
    w: CARD_W + 2 * RUN_CLEARANCE,
    h: CARD_H + 2 * RUN_CLEARANCE,
  });

  const grab = cardCenter(COLUMN_X[SOURCE_COLUMN], TABLEAU_Y);
  await h.debug.pointerDown(grab.x, grab.y);
  if ((await h.snapshot()).drag === null) {
    fail(
      `a run in hand after a press on the ${HELD_CARD} at ` +
        `(${String(grab.x)}, ${String(grab.y)}) (specs/controls.md: a press on ` +
        "a column's lowest face-up card lifts it)",
      "nothing was in hand after the press",
    );
  }

  await placeRun(h, AWAY_X, AWAY_Y);
  assertNull(
    (await h.snapshot()).dropTarget,
    "no drop target while the run is held away from every pile, so this frame " +
      "is the target drawn without its highlight (specs/table.md: the third " +
      "column position carries no pile in the top row)",
  );
  await h.advance(1);
  const unhighlighted = await sampleUnitGrid(h, grid);

  await placeRun(h, OVER_X, OVER_Y);
  assertDeepEqual(
    (await h.snapshot()).dropTarget,
    { pile: "tableau", index: TARGET_COLUMN },
    "the column holding the black eight named as the drop target under the " +
      "held red seven (specs/tableau.md: a column builds down in rank and " +
      "alternates in colour)",
  );
  await h.advance(1);
  await captureStill(h, "highlight");
  const highlighted = await sampleUnitGrid(h, grid);

  assertGreaterThan(
    maxDistance(unhighlighted, highlighted, visible),
    0,
    "the highlighted column drawn differently from the same column drawn " +
      "without its highlight, somewhere in the part of its drop rectangle " +
      `the held run does not cover (${String(visible.length)} of ` +
      `${String(grid.cells)} sampled points; specs/overview.md: a ` +
      "legal drop target under a held run reads apart from the same pile " +
      "drawn without the highlight)",
  );
});
