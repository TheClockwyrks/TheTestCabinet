// pointer/levelup-touch-accepts — a contact landing and lifting in an offer's
// rectangle accepts that offer.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("The pointer and touch"),
// rule 3: "a contact landing and lifting inside the rectangle of the item at
// `menuIndex` `i` selects that item and takes it exactly as `confirm` on it
// does." specs/ui.md ("`levelup`"): `confirm` "accepts the highlighted offer".
//
// WHY THIS IS A POINT OF ITS OWN. The level-up overlay is the one screen a run
// cannot get past without choosing, so a build that answers no contact there
// ends the night for a player on a touch device. The mouse's route is
// `pointer/levelup-click-accepts`'.
//
// HOW THE SCENARIO IS DRIVEN. An isolated night, a queued level-up whose offers
// are posed by `setNextOffers`, and the tick that opens the overlay; then a REAL
// contact landing at the middle of the SECOND offer's rectangle and lifting
// there. The second is chosen so a build that took the highlighted offer
// whatever the contact fell on is caught.
//
// THE TOLERANCE. None: a screen name, a queue count, and a weapon's level are
// exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  touchTapAt,
  weaponIn,
  type Harness,
} from "../harness";
import { menuPoints, night, openOffers } from "./stage";

/** Three candidates of an empty loadout's pool; the second is the one tapped. */
const OFFERS = ["ember", "pin", "wick"] as const;

/** The offer the contact lands in: the second of the three. */
const TAPPED = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the second offer and returns to playing when a contact takes it", async () => {
  await night(h);
  await openOffers(h, OFFERS);
  const points = await menuPoints(h, OFFERS.length, "for the level-up offers");

  const accepted = await touchTapAt(h, points[TAPPED]!);
  await captureStill(h, "accepted");

  assertEqual(accepted.screen, "playing", "the screen the accepted offer left");
  assertEqual(
    accepted.run.pendingLevelUps,
    0,
    "the level-ups queued after the acceptance",
  );
  assertEqual(
    weaponIn(accepted, OFFERS[TAPPED])?.level,
    1,
    `the level of ${OFFERS[TAPPED]}, the offer the contact took, afterwards`,
  );
  assertEqual(
    weaponIn(accepted, OFFERS[0]),
    undefined,
    `${OFFERS[0]}, the highlighted offer the contact did not take, held afterwards`,
  );
});
