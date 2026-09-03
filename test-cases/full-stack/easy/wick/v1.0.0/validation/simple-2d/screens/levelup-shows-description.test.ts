// screens/levelup-shows-description — the overlay describes its highlighted offer.
//
// WHAT THIS DECIDES. One thing, over the three kinds of thing an overlay can
// offer: the frame carries the line the specification gives the offer at
// `menuIndex`, a weapon's from `WEAPON_DESCRIPTIONS`, a passive's from
// `PASSIVE_DESCRIPTIONS`, and lamp oil's `LAMP_OIL_DESCRIPTION`. The three
// share one point because they exercise one rule the same way. That the line
// FOLLOWS the highlight is `levelup-description-follows-highlight`'s point.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`levelup`): "Beneath the offer list the overlay draws one more
//   line: the description of the offer at `menuIndex`, on one line. A weapon's
//   is its line in `WEAPON_DESCRIPTIONS`, a passive's is its line in
//   `PASSIVE_DESCRIPTIONS`, and lamp oil's is `LAMP_OIL_DESCRIPTION`."
//   specs/ui.md ("Descriptions"): "Every tool, trinket, enemy, gem, and pickup
//   carries one fixed line of copy, and the lines below are those strings
//   exactly", which is what `constants.ts` restates.
//   specs/progression.md ("The draw"): "When the pool is empty the overlay
//   offers exactly one item, `LAMP_OIL_ID`, which fills no slot."
//
// THE DRIVE, AND WHY ONE OFFER AT A TIME. Three scenes, each an isolated
// `playing` run whose overlay is opened by the tick a queued level-up opens it,
// and each overlay carries exactly ONE offer, which `setNextOffers` allows ("a
// list of `1` to `OFFER_COUNT` (`3`) distinct ids"). With one row on the screen
// the offer at `menuIndex` is the only offer there is, so no key is pressed and
// no other row can supply the line. The first two ids are candidates of an
// empty loadout's pool; the third scene fills every slot at its max level,
// which empties the pool, so lamp oil is offered on its own with nothing posed.
//
// THE TOLERANCE. Each line is matched as its words in order through
// `drewPhrase`, case ignored, which admits any font, spacing, and line wrap a
// build draws it under and refuses a build that shows other words. Nothing
// about where the line sits is read, since specs/ui.md fixes no layout.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  BASE_WEAPON_IDS,
  LAMP_OIL_DESCRIPTION,
  LAMP_OIL_ID,
  MAX_WEAPON_LEVEL,
  PASSIVES,
  PASSIVE_DESCRIPTIONS,
  PASSIVE_IDS,
  PASSIVE_SLOTS,
  WEAPON_DESCRIPTIONS,
  WEAPON_SLOTS,
  type PassiveId,
  type WeaponId,
} from "../constants";
import {
  captureStill,
  createHarness,
  drewPhrase,
  holdPassive,
  holdWeapon,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

let h: Harness;

/**
 * Fill every slot of both kinds at its max, which empties the candidate pool.
 * The weapons chosen place no aura and no lantern set, so the tick that opens
 * the overlay leaves the world as empty as it found it.
 */
function fillEverySlot(harness: Harness): void {
  const weapons: readonly WeaponId[] = BASE_WEAPON_IDS.filter(
    (id) => id !== "lantern" && id !== "halo",
  ).slice(0, WEAPON_SLOTS);
  for (const id of weapons) holdWeapon(harness, id, MAX_WEAPON_LEVEL);
  const passives: readonly PassiveId[] = PASSIVE_IDS.slice(0, PASSIVE_SLOTS);
  for (const id of passives) holdPassive(harness, id, PASSIVES[id].maxLevel);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws the weapon's, the passive's, and lamp oil's lines", async () => {
  isolate(h);
  h.debug.setNextOffers(["ember"]);
  const weapon = await openLevelUp(h, 1);
  assertEqual(weapon.screen, "levelup", "the screen the level-up opened");
  assertDeepEqual(weapon.run.offers, ["ember"], "the offer the overlay holds");
  assertEqual(weapon.menuIndex, 0, "the highlight the overlay opened with");

  const { calls: weaponCalls } = await h.frameDraw();
  captureStill(h, "description");
  assertEqual(
    drewPhrase(weaponCalls, WEAPON_DESCRIPTIONS.ember),
    true,
    "the line WEAPON_DESCRIPTIONS gives the highlighted weapon",
  );

  isolate(h);
  h.debug.setNextOffers(["glass"]);
  const passive = await openLevelUp(h, 1);
  assertDeepEqual(passive.run.offers, ["glass"], "the offer the overlay holds");

  const { calls: passiveCalls } = await h.frameDraw();
  assertEqual(
    drewPhrase(passiveCalls, PASSIVE_DESCRIPTIONS.glass),
    true,
    "the line PASSIVE_DESCRIPTIONS gives the highlighted passive",
  );

  isolate(h);
  fillEverySlot(h);
  const oil = await openLevelUp(h, 1);
  assertDeepEqual(oil.run.pool, [], "the candidate pool of a filled loadout");
  assertDeepEqual(
    oil.run.offers,
    [LAMP_OIL_ID],
    "the offers drawn over an empty pool",
  );

  const { calls: oilCalls } = await h.frameDraw();
  assertEqual(
    drewPhrase(oilCalls, LAMP_OIL_DESCRIPTION),
    true,
    "the line LAMP_OIL_DESCRIPTION gives the lamp-oil offer",
  );
});
