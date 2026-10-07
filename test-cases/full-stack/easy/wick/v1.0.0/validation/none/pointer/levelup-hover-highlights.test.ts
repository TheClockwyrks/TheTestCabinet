// pointer/levelup-hover-highlights — the pointer resting on the second offer
// moves the overlay's highlight onto it.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("The pointer"): "Every
// screen that shows a vertical menu answers the pointer: `title`, `almanac`,
// `levelup`, `paused`, `fallen`, and `dawn` ... On `title`, `levelup`, `paused`,
// `fallen`, and `dawn` that is every item of the menu, and the rectangle at
// position `i` belongs to the item at `menuIndex` `i`", and rule 1: "The pointer
// inside the rectangle of the item at `menuIndex` `i`, with `menuIndex` not `i`,
// sets `menuIndex` to `i`". specs/ui.md ("`levelup`") gives the overlay "the
// offers in `offers`, listed vertically in that order", with "`menuIndex` is `0`
// on opening", so the second offer is the one `menuIndex` `1` belongs to.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. `menuIndex` off the snapshot: the
// highlight is a number the state carries, and which offer is drawn distinctly
// is the build's, since specs/ui.md fixes "no palette, no font, no layout, and
// no styling".
//
// HOW THE SCENARIO IS DRIVEN. An isolated night with an empty loadout, then
// three named candidates queued through `setNextOffers` and one queued level-up,
// so the overlay opens the real way and presents exactly three rows for the
// three rectangles to belong to. `menuRects()` reports where this build drew
// them; the pointer is moved to the middle of the second, and exactly one frame
// runs after the move, because the pointer rules are "applied on every frame".
//
// THE TOLERANCE. None: a screen name and an index are exact comparisons, and the
// aim is inside the rectangle by construction.

import { afterEach, beforeEach, it } from "vitest";
import { captureStill, createHarness, hoverAt, type Harness } from "../harness";
import { assertHighlight, menuPoints, night, openOffers } from "./stage";

/** Three candidates of an empty loadout's pool, in the order the overlay lists them. */
const OFFERS = ["ember", "pin", "wick"] as const;

/** The offer the pointer rests on: the second of the three. */
const HOVERED = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads menuIndex 1 with the pointer inside the second offer's rectangle", async () => {
  await night(h);
  await openOffers(h, OFFERS);
  const points = await menuPoints(h, OFFERS.length, "for the level-up offers");

  const hovered = await hoverAt(h, points[HOVERED]!);
  await captureStill(h, "hover");

  assertHighlight(
    hovered,
    "levelup",
    HOVERED,
    "under a pointer inside the second offer's rectangle",
  );
});
