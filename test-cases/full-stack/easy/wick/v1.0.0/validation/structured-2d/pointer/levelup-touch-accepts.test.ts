// Wick — pointer/levelup-touch-accepts: a contact landing and lifting in an
// offer's rectangle accepts that offer.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/controls.md`, "The pointer
// and touch", rule 3: "a contact landing and lifting inside the rectangle of the
// item at `menuIndex` `i` selects that item and takes it exactly as `confirm` on
// it does." `specs/ui.md`, "`levelup`": `confirm` "accepts the highlighted
// offer".
//
// WHY THIS IS ITS OWN POINT. The overlay holds the run until an offer is taken,
// so a build that answers no contact there ends the night for a player on a
// touch device. The mouse's route is `pointer/levelup-click-accepts`'.
//
// WHAT IS READ. The screen, the queue, and the loadout after the gesture. The
// SECOND offer is taken, so a build that took the highlighted one whatever the
// contact fell on is caught.
//
// THE DRIVE. An isolated night, the offers posed by `setNextOffers`, the tick
// that opens the overlay, then a contact landing at the middle of the second
// offer's rectangle and lifting there, one partial frame each, so the run read
// back is the one the acceptance handed over.
//
// THE TOLERANCE. None: a screen name, a queue count, and a loadout.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { type OfferId } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  menuRects,
  openLevelUp,
  type Harness,
} from "../harness";
import { touchTapRectPartial } from "./pointing";

/** The offers the overlay presents, in order; the second is the one taken. */
const OFFERS: readonly OfferId[] = ["ember", "tallow", "lure"];

/** The index of the second offer. */
const TAPPED = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("applies the second offer and returns to playing when a contact takes it", async () => {
  h.reset();
  isolate(h);
  h.debug.setNextOffers(OFFERS);
  const overlay = await openLevelUp(h, 1);
  assertEqual(overlay.screen, "levelup", "the screen the contact lands on");
  assertDeepEqual(overlay.run.offers, OFFERS, "the offers the overlay shows");
  assertEqual(overlay.menuIndex, 0, "the highlighted offer before the contact");

  const rects = menuRects(h);
  assertLength(rects, OFFERS.length, "the overlay's rectangles, one per offer");

  const after = await touchTapRectPartial(h, rects[TAPPED]);
  captureStill(h, "accepted");

  assertEqual(after.screen, "playing", "the screen the contact left");
  assertEqual(
    after.run.pendingLevelUps,
    0,
    "the level-ups pending after the contact accepted one",
  );
  assertLength(after.run.passives, 1, "the passives held after the contact");
  assertEqual(
    after.run.passives[0].id,
    OFFERS[TAPPED],
    "the item the contact applied",
  );
  assertLength(
    after.run.weapons,
    0,
    "the weapons held, the first offer untaken",
  );
});
