// screens/levelup-shows-description — the overlay draws the highlighted offer's
// line beneath the offer list, whichever of the three records the line comes
// from.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`levelup`"): "Beneath the offer
// list the overlay draws one more line: the description of the offer at
// `menuIndex`, on one line. A weapon's is its line in `WEAPON_DESCRIPTIONS`, a
// passive's is its line in `PASSIVE_DESCRIPTIONS`, and lamp oil's is
// `LAMP_OIL_DESCRIPTION`." specs/ui.md ("Descriptions"): "Every tool, trinket,
// enemy, gem, and pickup carries one fixed line of copy, and the lines below are
// those strings exactly", which fixes the strings this point looks for. The
// sentence names three sources, so three overlays are read: a weapon at the head
// of one, a passive at the head of the next, and lamp oil alone in the third.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. On each overlay, that the line the
// highlighted offer carries is drawn, and that it is drawn below the offer list,
// which is the whole of "beneath the offer list ... the description of the offer
// at `menuIndex`". What the lines of the offers that are NOT highlighted do is
// not read here; the line the highlight leaves belongs to
// `screens/levelup-description-follows-highlight`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with an empty loadout, so
// nothing else is in the world or in the HUD's slots to draw text over a row.
// The first two overlays are queued through `setNextOffers`, the first headed by
// a weapon and the second by a passive, and each is left by accepting its first
// offer, which is the offer the check just read. `menuIndex` is `0` on opening
// every overlay, so the highlighted offer is the head of the list and nothing is
// pressed. The third overlay is the one an empty pool leaves —
// specs/progression.md: "When the pool is empty the overlay offers exactly one
// item, `LAMP_OIL_ID`" — reached by holding every weapon slot and every passive
// slot at its max. The overlay ticks nothing, so each frame read is the overlay
// as it opened.
//
// THE TOLERANCE. The copy is matched ignoring case and whitespace, across the
// runs of text the frame drew joined in reading order (the shared harness's
// `drewTextAnywhere`) — so a build that letter-spaces a line or wraps it in
// marks of its own passes, and the lines stay distinct from the offer names
// under that reading. "Beneath the offer
// list" is a strict inequality between two drawn rows, which no tolerance can
// soften.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { LAMP_OIL_ID, descriptionOf } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  assertShows,
  assertStacked,
  night,
  offerName,
  openLampOil,
  openOffers,
  shown,
} from "./stage";

/** Three candidates of an empty loadout's pool, headed by a weapon. */
const WEAPON_OFFERS = ["ember", "wick", "pin"] as const;

/** Three candidates of a pool with every passive slot free, headed by a passive. */
const PASSIVE_OFFERS = ["wick", "oil", "glass"] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a weapon's, a passive's, and lamp oil's line beneath the offer list", async () => {
  await night(h);

  const withWeapon = await openOffers(h, WEAPON_OFFERS);
  assertEqual(
    withWeapon.menuIndex,
    0,
    "the highlighted offer the line describes",
  );
  const weaponPage = await shown(h);
  await captureStill(h, "description");
  assertShows(
    weaponPage,
    descriptionOf(WEAPON_OFFERS[0]),
    "the overlay's line for a highlighted weapon, from WEAPON_DESCRIPTIONS",
  );
  assertStacked(
    weaponPage,
    offerName(WEAPON_OFFERS[WEAPON_OFFERS.length - 1]),
    descriptionOf(WEAPON_OFFERS[0]),
    "the overlay's line, beneath the offer list",
  );

  await h.debug.choose(0);
  assertEqual(
    (await h.snapshot()).screen,
    "playing",
    "the screen the accepted weapon left",
  );

  const withPassive = await openOffers(h, PASSIVE_OFFERS);
  assertEqual(
    withPassive.menuIndex,
    0,
    "the highlighted offer the line describes",
  );
  const passivePage = await shown(h);
  assertShows(
    passivePage,
    descriptionOf(PASSIVE_OFFERS[0]),
    "the overlay's line for a highlighted passive, from PASSIVE_DESCRIPTIONS",
  );
  assertStacked(
    passivePage,
    offerName(PASSIVE_OFFERS[PASSIVE_OFFERS.length - 1]),
    descriptionOf(PASSIVE_OFFERS[0]),
    "the overlay's line, beneath the offer list",
  );

  await h.debug.choose(0);
  assertEqual(
    (await h.snapshot()).screen,
    "playing",
    "the screen the accepted passive left",
  );

  const withOil = await openLampOil(h);
  assertEqual(withOil.menuIndex, 0, "the highlighted offer the line describes");
  const oilPage = await shown(h);
  assertShows(
    oilPage,
    descriptionOf(LAMP_OIL_ID),
    "the overlay's line for a highlighted lamp oil, LAMP_OIL_DESCRIPTION",
  );
  assertStacked(
    oilPage,
    offerName(LAMP_OIL_ID),
    descriptionOf(LAMP_OIL_ID),
    "the overlay's line, beneath the offer list",
  );
});
