// presentation/held-run-drawn-above — a held run is drawn over the piles.
//
// THE RULE. specs/controls.md, of the run a press lifts: "it is drawn above the
// piles it passes over", and specs/overview.md's legibility table says the same
// from the player's side, the row "A run in hand": "A card or run being dragged
// reads as lifted above the piles it passes over." A run carried UNDER the table
// disappears the moment it crosses a pile, and a player dragging it has nothing
// to aim with.
//
// WHAT IT DECIDES. The drawing ORDER, and only that: where the held run overlaps
// a pile, the pixels are the run's. Where the run is carried to is
// `handling.drag-follows-pointer`, and what a release does with it is the
// `handling` group's as well.
//
// HOW "THE PIXELS ARE THE RUN'S" IS READ. Three frames of one gesture. The pile
// alone is read first, before anything is lifted. The run is then lifted and
// carried out over bare felt, where it is read on its own. Finally it is carried
// onto the pile, and the same footprint is read a third time. If the run is drawn
// above, that third reading is the run's own colour; if it is drawn beneath, it
// is the pile's. So the verdict is which of the two the overlap is NEARER, and
// the point needs no colour of its own — specs/overview.md fixes no palette.
//
// THE TWO ARE POSED SO THEY CANNOT LOOK ALIKE. The run is a face-up card and the
// pile it is carried over is face-DOWN, which specs/overview.md's legibility
// table already requires to read apart ("A face-down card reads apart from a
// face-up card", `presentation/back-distinct-from-face`). A run carried over
// another face-up card would have been compared against something a build is free
// to draw exactly like it, and the reading would have decided nothing.
//
// THE TARGET REFUSES THE RUN, and that too is deliberate: specs/tableau.md gives
// a column whose "lowest card is face-down" nothing it accepts, so no drop target
// is live while the run is over it and no highlight is drawn under the run. What
// a highlight looks like is `presentation/drop-highlight-visible`, and it stays
// out of this reading.
//
// THE WORLD IT POSES. `openTable` empties all thirteen piles; one face-up card
// goes on column `0` and three face-down cards on column `1`. Nothing else is on
// the table, and the pointer is driven through the debug surface, which
// specs/instrumentation.md feeds into the same input path a player's pointer
// feeds.

import { afterEach, beforeEach, it } from "vitest";
import { COLUMN_X, TABLEAU_Y } from "../../src/constants";
import { assertLessThan, fail } from "../assert";
import {
  captureStill,
  cardCenter,
  colorDistance,
  columnCardTopLeft,
  createHarness,
  drawFrame,
  facesOf,
  openTable,
  pileOf,
  poseColumn,
  type Harness,
} from "../harness";
import { cardColor } from "./reading";

/** The run lifted: one face-up card, on a column of its own. */
const RUN = "KS";
const FROM = 0;

/** The pile it is carried over: three face-down cards, which accept nothing. */
const PILE = ["#5D", "#8C", "#9H"];
const OVER = 1;

/**
 * Where the run is parked to be read on its own, in logical units.
 *
 * Left of `COLUMN_X[0]` (`224`) and below the top row, so the card sits on bare
 * felt: specs/table.md puts every pile on a column position, and the margin left
 * of the first one carries none of them.
 */
const BARE = { x: 120, y: 420 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a held run over the pile it passes across", async () => {
  openTable(h);
  poseColumn(h, FROM, [RUN]);
  poseColumn(h, OVER, PILE);

  // The pile's lowest card, which is the one drawn over the rest of that column
  // (specs/table.md), and the footprint the run is carried onto.
  const under = columnCardTopLeft(
    OVER,
    PILE.length - 1,
    facesOf(pileOf(h.snapshot(), "tableau", OVER)),
  );
  await drawFrame(h);
  const pile = cardColor(h, under.x, under.y);

  // Lifted, and carried out over bare felt, where the run is read on its own.
  const grab = cardCenter(COLUMN_X[FROM], TABLEAU_Y);
  h.debug.pointerDown(grab.x, grab.y);
  h.debug.pointerMove(BARE.x, BARE.y);
  await drawFrame(h);
  const away = h.snapshot().drag;
  if (away === null) {
    fail(
      `a run in hand after a press on the ${RUN} at (${grab.x}, ${grab.y}) ` +
        "(specs/controls.md: a press on a face-up card in a column lifts that " +
        "card and every card below it)",
      away,
    );
  }
  const run = cardColor(h, away.x, away.y);

  // And carried onto the pile.
  const onto = cardCenter(under.x, under.y);
  h.debug.pointerMove(onto.x, onto.y);
  await drawFrame(h);
  captureStill(h, "held");
  const held = h.snapshot().drag;
  if (held === null) {
    fail(
      "the run still in hand while the pointer carries it across the table " +
        "(specs/controls.md: it is the run in hand from that moment until the " +
        "gesture ends)",
      held,
    );
  }
  const overlap = cardColor(h, held.x, held.y);

  assertLessThan(
    colorDistance(overlap, run),
    colorDistance(overlap, pile),
    "the overlap, " +
      `rgb(${overlap.r.toFixed(0)}, ${overlap.g.toFixed(0)}, ${overlap.b.toFixed(0)}), ` +
      "to read as the held run, " +
      `rgb(${run.r.toFixed(0)}, ${run.g.toFixed(0)}, ${run.b.toFixed(0)}), ` +
      "rather than as the pile beneath it, " +
      `rgb(${pile.r.toFixed(0)}, ${pile.g.toFixed(0)}, ${pile.b.toFixed(0)}) ` +
      "— the two distances, out of 441 (specs/controls.md: a held run is drawn " +
      "above the piles it passes over)",
  );
});
