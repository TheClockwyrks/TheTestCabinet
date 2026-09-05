// presentation/drop-highlight-visible — a highlighted target reads as highlighted.
//
// THE RULE. specs/controls.md: "While a run is held, the pile that would accept
// it, if any, is the drop target, and it is drawn as highlighted", and
// specs/overview.md's legibility table, the row "The drop target": "A legal drop
// target under a held run reads apart from the same pile drawn without the
// highlight." The highlight is the only thing that tells a player, mid-drag,
// which pile will take the run, so a highlight a player cannot see costs every
// drop its aim.
//
// WHAT IT DECIDES. Whether the highlight is DRAWN: the same pile, under the same
// held run, drawn once as the drop target and once not, and whether the two
// drawings differ at all. How loudly it reads is the reviewer's. WHICH pile is
// the target is
// `handling.drop-target-tracks-pointer`, and what a release then does with the
// run is the `handling` group's too.
//
// THE COMPARISON IS THE PILE AGAINST ITSELF, so nothing here knows a colour and
// none is fixed: specs/overview.md leaves "the palette, the type, and every other
// aspect of the look" to the build. The run stays in hand across both frames and
// only the pointer moves, so the two frames differ in the highlight and in where
// the held card is, and nothing else.
//
// THE HELD CARD IS EXCLUDED FROM THE READING. It is drawn above the pile
// (specs/controls.md, `presentation/held-run-drawn-above`), so wherever it sits
// it is not the pile, and its own pixels moved between the two frames. The cells
// it covers — with a margin around them for a shadow or a lift a build may draw
// under it — are therefore left out of both readings, and what is compared is the
// part of the drop rectangle a player can still see. The rest of that rectangle
// is read whole, because the difference may land anywhere in it: a build is free
// to highlight its target as a wash, an outline, a glow or a brightened card, and
// each of those lands somewhere different.
//
// THE TARGET IS A COLUMN HOLDING A RUN, for two reasons. Its drop rectangle
// "runs from `TABLEAU_Y` down to the bottom edge of that column's lowest drawn
// card" (specs/table.md), which is `242` units against the held card's `140`, so
// a large part of it is visible however a build carries the run — the reading
// does not quietly depend on the carry rule specs/controls.md fixes. And the run
// offered to it is accepted by the plainest rule specs/tableau.md has, a card one
// rank lower and of the other colour than the column's lowest card.
//
// A BUILD THAT NEVER MAKES THE PILE A TARGET reads a difference near zero and
// fails here, and the failure names the drop target the build reported instead.
// That build also fails the `tableau` and `handling` points that own the rule
// itself, which is the correct accounting: it drew no highlight because it found
// no target.
//
// THE WORLD IT POSES. `openTable` empties all thirteen piles; a four-card run
// goes on column `1` and the single card that stacks onto it on column `0`.
// Nothing else is on the table, and the pointer is driven through the debug
// surface, which specs/instrumentation.md feeds into the same input path a
// player's pointer feeds.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, fail } from "../assert";
import { CARD_H, CARD_W, COLUMN_X, TABLEAU_Y } from "../constants";
import {
  captureStill,
  cardCenter,
  colorDistance,
  createHarness,
  drawFrame,
  dropRect,
  openTable,
  poseColumn,
  type Harness,
  type Point,
  type Rgb,
} from "../harness";
import { pointColor } from "./reading";

/** The run offered: a black nine, onto a column whose lowest card is a red ten. */
const RUN = "9S";
const FROM = 0;

/** The target: a column holding a four-card run, lowest card the ten of diamonds. */
const TARGET_CARDS = ["KS", "QH", "JC", "10D"];
const TARGET = 1;

/**
 * Where the run is parked for the frame that draws the pile UNhighlighted.
 *
 * Left of `COLUMN_X[0]` (`224`) and below the top row, so the run's leading card
 * sits on bare felt and its centre lies in no pile's drop rectangle: specs/table.md
 * puts every pile on a column position, and the margin left of the first one
 * carries none of them.
 */
const BARE: Point = { x: 120, y: 420 };

/**
 * How far into the target's drop rectangle the run's leading card is aimed, in
 * logical units.
 *
 * Just inside its top edge, so the release rule specs/controls.md fixes — the
 * pile whose rectangle holds "the center of the run's leading card" — resolves to
 * this column, while the card itself sits as high in the rectangle as it can and
 * leaves the most of it showing.
 */
const AIM_INSET = 4;

/** How finely the visible part of the rectangle is sampled, in logical units. */
const SAMPLE_PITCH = 2;

/**
 * How far outside the held card's own footprint its pixels are treated as its
 * own, in logical units.
 *
 * specs/overview.md leaves the look of a run in hand to the build, and a build
 * that draws it as lifted commonly casts a shadow or an edge a few units beyond
 * the card. Those pixels travel with the run rather than belonging to the pile,
 * so they are left out of the reading along with the card itself. `12` is a
 * tenth of a card and far short of the `242`-unit rectangle being read.
 */
const HELD_MARGIN = 12;

/*
 * The reading itself: the same pile, drawn once as the drop target and once not,
 * has to differ SOMEWHERE a player can still see.
 *
 * Nothing is measured beyond that. specs/overview.md requires a legal drop target
 * under a held run to read apart from the same pile drawn without the highlight,
 * and it fixes no colour, no form and no coverage: a wash, an outline, a glow and
 * a brightened card are all honest, and how loudly any of them reads is the
 * reviewer's. Rendering is deterministic here — the same drawing operations
 * produce the same buffer, and the run stays in hand across both frames — so a
 * build that drew no highlight paints the two frames identically at every point,
 * and any difference at all is the highlight.
 *
 * It is read as the FURTHEST the two drawings get from each other anywhere in the
 * visible rectangle, because a highlight is commonly an outline or a glow that
 * lands on part of the pile rather than across all of it.
 */

/**
 * The points of `rect` a player can still see, given a card held over it.
 *
 * A grid at {@link SAMPLE_PITCH}, less every point inside the held card's
 * footprint grown by {@link HELD_MARGIN}. Both frames are read at exactly these
 * points, so what the comparison holds against itself is the same pile.
 */
function visiblePoints(
  rect: { x: number; y: number; w: number; h: number },
  held: Point,
): Point[] {
  const points: Point[] = [];
  const cols = Math.max(1, Math.round(rect.w / SAMPLE_PITCH));
  const rows = Math.max(1, Math.round(rect.h / SAMPLE_PITCH));
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = rect.x + (rect.w * (col + 0.5)) / cols;
      const y = rect.y + (rect.h * (row + 0.5)) / rows;
      const covered =
        x >= held.x - HELD_MARGIN &&
        x <= held.x + CARD_W + HELD_MARGIN &&
        y >= held.y - HELD_MARGIN &&
        y <= held.y + CARD_H + HELD_MARGIN;
      if (!covered) points.push({ x, y });
    }
  }
  return points;
}

/** What those points were painted, in the frame currently on the canvas. */
function colorsAt(h: Harness, points: readonly Point[]): Rgb[] {
  return points.map((point) => pointColor(h, point.x, point.y));
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a legal drop target apart from the same pile unhighlighted", async () => {
  openTable(h);
  poseColumn(h, FROM, [RUN]);
  poseColumn(h, TARGET, TARGET_CARDS);

  // The rectangle the target answers a release in (specs/table.md), read before
  // the lift, when the column holds exactly the cards posed onto it.
  const rect = dropRect(h.snapshot(), "tableau", TARGET);

  // Lifted, and carried out over bare felt, where no pile is the target.
  const grab = cardCenter(COLUMN_X[FROM], TABLEAU_Y);
  h.debug.pointerDown(grab.x, grab.y);
  h.debug.pointerMove(BARE.x, BARE.y);
  await drawFrame(h);

  // Then over the target, which is the frame that must be drawn as highlighted.
  h.debug.pointerMove(rect.x + rect.w / 2, rect.y + AIM_INSET);
  await drawFrame(h);
  captureStill(h, "highlight");
  const snapshot = h.snapshot();
  const held = snapshot.drag;
  if (held === null) {
    fail(
      `a run in hand after a press on the ${RUN} at (${grab.x}, ${grab.y}) ` +
        "(specs/controls.md: a press on a face-up card in a column lifts that " +
        "card and every card below it)",
      held,
    );
  }
  const points = visiblePoints(rect, held);
  const highlighted = colorsAt(h, points);

  // And carried away again, which draws the same pile with no highlight on it.
  h.debug.pointerMove(BARE.x, BARE.y);
  await drawFrame(h);
  const plain = colorsAt(h, points);

  let apart = 0;
  for (let i = 0; i < points.length; i += 1) {
    apart = Math.max(apart, colorDistance(highlighted[i], plain[i]));
  }

  assertGreaterThan(
    apart,
    0,
    "the target column drawn under the held run drawn differently from the " +
      "same column drawn with the run carried away, anywhere in the " +
      `${String(rect.w)} x ${String(rect.h)} drop rectangle at (${String(rect.x)}, ` +
      `${String(rect.y)}) the run does not cover ` +
      "(specs/controls.md: the pile that would accept the run is the drop " +
      "target, and it is drawn as highlighted) — with the run over it the " +
      `build reported its drop target as ${JSON.stringify(snapshot.dropTarget)}`,
  );
});
