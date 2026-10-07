// screens/levelup-lists-offers — the overlay lists its offers in order, with
// the highlighted one drawn distinctly.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`levelup`"): the overlay "shows
// `LEVEL_UP_TEXT` ... and the offers in `offers`, listed vertically in that
// order". specs/progression.md ("Choosing"): "The offers are listed vertically
// in the order of `offers`, and the item at `menuIndex` is highlighted."
// specs/ui.md ("Presentation"): "On every menu the item at `menuIndex` is drawn
// distinctly from the others, so a player always sees which item `confirm`
// would accept." So the offers' names run down the stage in the order `offers`
// holds them, and moving the highlight from the first to the second changes
// what is drawn on BOTH of their rows: the first loses the highlight and the
// second gains it.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with an empty loadout, so
// nothing else is in the world or in the HUD's slots to draw over a row, and
// three named offers queued through `setNextOffers` so the rows the check looks
// for are the ones it posed. The highlight is moved with a REAL `ArrowDown`
// held across one frame, and the overlay ticks nothing, so the only thing that
// differs between the two frames is what the build draws for the highlight.
//
// THE TOLERANCE. The names are matched folded and located by the shortest run
// of consecutive text draws that spells one. The band read around each row is
// the shorter of `48` units and the gap to its neighbour, so a band never
// reaches the row below, and any difference at all inside it counts: the
// specification asks for a distinct drawing and fixes no styling, so a build
// that changes a colour, a weight, or a marker passes and one that changes
// nothing fails.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  pixelsDiffering,
  pressDown,
  type Harness,
} from "../harness";
import {
  bandPixels,
  mustRowY,
  night,
  offerName,
  openOffers,
  shown,
} from "./stage";

/** Three candidates of an empty loadout's pool, in the order they are offered. */
const OFFERS = ["ember", "pin", "wick"] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the three offers down the stage in order, the highlight moving with menuIndex", async () => {
  await night(h);
  const opened = await openOffers(h, OFFERS);
  assertEqual(opened.menuIndex, 0, "the highlighted offer before the press");

  const page = await shown(h);
  const rows = OFFERS.map((id) =>
    mustRowY(page, offerName(id), `the offer ${id}`),
  );
  await captureStill(h, "offers");
  for (let i = 1; i < rows.length; i += 1) {
    assertGreaterThan(
      rows[i]!,
      rows[i - 1]!,
      `the row of offer ${i} (${OFFERS[i]}), below offer ${i - 1} (${OFFERS[i - 1]})`,
    );
  }

  const gap = rows[1]! - rows[0]!;
  const firstBefore = await bandPixels(h, rows[0]!, gap);
  const secondBefore = await bandPixels(h, rows[1]!, gap);
  const moved = await pressDown(h);
  assertEqual(moved.menuIndex, 1, "the highlighted offer after ArrowDown");
  const firstAfter = await bandPixels(h, rows[0]!, gap);
  const secondAfter = await bandPixels(h, rows[1]!, gap);

  assertGreaterThan(
    pixelsDiffering(firstBefore, firstAfter),
    0,
    "pixels changed on the first offer's row when the highlight left it",
  );
  assertGreaterThan(
    pixelsDiffering(secondBefore, secondAfter),
    0,
    "pixels changed on the second offer's row when the highlight arrived",
  );
});
