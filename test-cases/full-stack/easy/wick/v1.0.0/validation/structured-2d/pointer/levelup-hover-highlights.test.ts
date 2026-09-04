// Wick — pointer/levelup-hover-highlights: the pointer resting on the second
// offer highlights it.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/controls.md`, The pointer:
// `levelup` is one of the screens that "answers the pointer", and "On `title`,
// `levelup`, `paused`, `fallen`, and `dawn` that is every item of the menu, and
// the rectangle at position `i` belongs to the item at `menuIndex` `i`." Rule
// 1, Hover: "The pointer inside the rectangle of the item at `menuIndex` `i`,
// with `menuIndex` not `i`, sets `menuIndex` to `i`." `specs/ui.md`,
// "`levelup`", shows "the offers in `offers`, listed vertically in that order"
// and puts `menuIndex` at `0` on opening, so the second offer is `menuIndex`
// `1`.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. `menuIndex` off the snapshot,
// which is the offer `confirm` would accept. Nothing is accepted here: a hover
// moves a highlight and no more, so `screen` stays `levelup` and
// `pendingLevelUps` stays where the overlay opened it.
//
// THE DRIVE. An isolated `playing` run holding nothing, every driver switch
// off, with three offers queued BY NAME through `setNextOffers`, which
// `specs/instrumentation.md` makes the overlay present as "exactly that list in
// that order"; one level-up posed pending and the tick that opens the overlay;
// then the second offer's rectangle read off `menuRects` and the pointer moved
// to its middle for one frame. The point is the build's own: the specification
// fixes no layout for the offer list.
//
// THE TOLERANCE. None on the index. The point is the rectangle's centre, the
// one point inside it that no padding, border, or rounding can put outside.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { type OfferId } from "../constants";
import {
  captureStill,
  createHarness,
  hoverRect,
  isolate,
  menuRects,
  openLevelUp,
  type Harness,
} from "../harness";

/** The offers the overlay presents, in order; the second is the one hovered. */
const OFFERS: readonly OfferId[] = ["ember", "tallow", "lure"];
/** The index of the second offer. */
const SECOND_OFFER = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads menuIndex 1 with the pointer inside the second offer", async () => {
  isolate(h);
  h.debug.setNextOffers(OFFERS);
  const overlay = await openLevelUp(h, 1);
  assertEqual(overlay.screen, "levelup", "the screen the pointer rests on");
  assertDeepEqual(overlay.run.offers, OFFERS, "the offers the overlay shows");
  assertEqual(overlay.menuIndex, 0, "menuIndex on opening the overlay");

  const rects = menuRects(h);
  assertLength(
    rects,
    OFFERS.length,
    "the overlay's rectangles, one per offer (specs/controls.md, The pointer)",
  );

  const after = await hoverRect(h, rects[SECOND_OFFER]);
  captureStill(h, "hover");

  assertEqual(after.screen, "levelup", "the screen the hover left");
  assertEqual(
    after.menuIndex,
    SECOND_OFFER,
    "menuIndex with the pointer inside the second offer's rectangle (specs/controls.md, Hover)",
  );
  assertEqual(
    after.run.pendingLevelUps,
    1,
    "the level-ups still pending, a hover accepting nothing",
  );
});
