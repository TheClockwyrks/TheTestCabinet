// presentation/slot-distinct-from-table — an empty slot reads apart from the felt.
//
// THE RULE. specs/overview.md's legibility table, the row "An empty pile": "A
// pile holding no cards reads as an empty slot at its anchor, apart from the bare
// table", which specs/table.md states as the mark's purpose: "so an empty slot
// reads apart from the bare table".
//
// WHAT IT DECIDES, AND WHAT IT LEAVES ALONE. Whether the mark can be SEEN against
// the felt. That it is drawn at all, at each of the thirteen anchors, is
// `presentation/empty-slot-drawn`.
//
// THE READING IS THE FURTHEST POINT OF THE SLOT, NOT ITS MEAN, and that is
// deliberate. specs/table.md asks for "a card-sized mark", not for a card-sized
// FIELD OF COLOUR: an outline around the footprint, a corner bracket, a ghosted
// pip are all marks a build may honestly draw, and every one of them leaves most
// of the footprint showing the felt underneath. A mean over the footprint would
// fail such a slot for being mostly felt, which is what it is meant to be. So
// what is measured is how far the slot gets from the table anywhere inside its
// own footprint — a build that draws nothing there gets nowhere.
//
// WHERE THE TABLE IS READ. specs/table.md: "The gaps between the columns carry no
// pile and nothing card-sized is drawn in them", so the `22`-unit strip between
// column `0` and column `1` is felt and nothing else, and it is the felt
// immediately beside the slot this point reads on column `0`.
//
// THE PALETTE IS THE BUILD'S: specs/overview.md fixes no colour, so nothing here
// knows a hex value and what is measured is the distance between two things the
// build itself painted.
//
// THE WORLD IT POSES. `openTable` and nothing else: all thirteen piles empty,
// which is the state an empty slot exists in.

import { afterEach, beforeEach, it } from "vitest";
import { COLUMN_X, TABLEAU_Y } from "../../src/constants";
import { assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  drawFrame,
  openTable,
  type Harness,
} from "../harness";
import { cardSamples, maxDistanceTo, tableColor } from "./reading";

/** The pile the slot is read at, and the anchor specs/table.md fixes for it. */
const COLUMN = 0;
const ANCHOR_X = COLUMN_X[COLUMN];
const ANCHOR_Y = TABLEAU_Y;

/**
 * How far apart the slot and the table must read, in RGB distance out of `441`.
 *
 * The review item's own figure. specs/overview.md requires the slot to read
 * "apart from the bare table" and fixes no colour, so the bar is what a
 * measurement can honestly call a mark rather than nothing: `30` is a fifteenth
 * of the scale. It is set below every other figure in this group on purpose — an
 * empty slot is a quiet hint about where a pile is and not something a build
 * should have to shout, and specs/table.md gives it no more work than being seen.
 * The `none` and `structured-2d` suites hold the same requirement to the same
 * figure.
 */
const APART_MIN = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws an empty slot apart from the bare table", async () => {
  openTable(h);
  await drawFrame(h);
  captureStill(h, "slot");

  const table = tableColor(h);
  const apart = maxDistanceTo(cardSamples(h, ANCHOR_X, ANCHOR_Y), table);

  assertGreaterThanOrEqual(
    apart,
    APART_MIN,
    "the furthest the empty slot at " +
      `(${ANCHOR_X}, ${ANCHOR_Y}) gets from the table beside it, ` +
      `rgb(${table.r.toFixed(0)}, ${table.g.toFixed(0)}, ${table.b.toFixed(0)}), ` +
      "out of 441 (specs/table.md: a pile holding no cards draws a card-sized " +
      "mark at its anchor, so an empty slot reads apart from the bare table)",
  );
});
