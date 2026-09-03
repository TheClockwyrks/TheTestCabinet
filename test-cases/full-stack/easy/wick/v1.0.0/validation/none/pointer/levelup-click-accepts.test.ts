// pointer/levelup-click-accepts — a click inside an offer's rectangle accepts
// that offer.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("The pointer"), rule 2: "A
// primary press edge inside the rectangle of the item at `menuIndex` `i` sets
// `menuIndex` to `i` ... and then takes that item exactly as `confirm` on it
// does." specs/ui.md ("`levelup`"): "`confirm` accepts the highlighted offer, as
// `specs/progression.md` states. Then, if another level-up is queued, the next
// overlay opens with a fresh set of offers and `menuIndex = 0`; else
// `screen = playing`". specs/progression.md ("Choosing"): "A weapon or passive
// not held | It enters the first free slot of its kind at level `1`", and
// "Accepting decrements `pendingLevelUps`."
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. The slot the accepted item landed
// in, the level-ups left queued, and the screen. The offer clicked is the SECOND
// and the highlight stands on the first, so the item held afterwards says which
// of the two the click took: a build that accepted the highlighted offer instead
// holds the first, which is asserted absent.
//
// HOW THE SCENARIO IS DRIVEN. An isolated night with an empty loadout and
// exactly one level-up queued, so the acceptance has a free slot to fill and
// nothing else queued to open a second overlay. Three named candidates are
// queued through `setNextOffers`, and the primary button is pressed at the
// middle of the second rectangle `menuRects()` reports, with exactly one frame
// between press and release.
//
// THE TOLERANCE. None: a screen name, a slot's id and level, and a count of
// queued level-ups are exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  clickAt,
  createHarness,
  weaponIn,
  type Harness,
} from "../harness";
import { menuPoints, night, openOffers } from "./stage";

/** Three candidates of an empty loadout's pool; the second is the one clicked. */
const OFFERS = ["ember", "pin", "wick"] as const;

/** The offer the click lands in: the second of the three. */
const CLICKED = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the second offer and returns to playing when a click lands in it", async () => {
  await night(h);
  const opened = await openOffers(h, OFFERS);
  assertEqual(
    opened.run.pendingLevelUps,
    1,
    "the level-ups queued when the overlay opened",
  );
  const points = await menuPoints(h, OFFERS.length, "for the level-up offers");

  const accepted = await clickAt(h, points[CLICKED]!);
  await captureStill(h, "accepted");

  assertEqual(accepted.screen, "playing", "the screen the accepted offer left");
  assertEqual(
    accepted.run.pendingLevelUps,
    0,
    "the level-ups queued after the acceptance",
  );
  assertEqual(
    weaponIn(accepted, OFFERS[CLICKED])?.level,
    1,
    `the level of ${OFFERS[CLICKED]}, the offer the click landed in, afterwards`,
  );
  assertEqual(
    weaponIn(accepted, OFFERS[0]),
    undefined,
    `${OFFERS[0]}, the highlighted offer the click did not land in, held afterwards`,
  );
});
