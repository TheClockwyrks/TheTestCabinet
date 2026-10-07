// screens/offer-tag-new — an offer for an item not held is tagged NEW.
//
// WHAT THIS DECIDES. One thing, over the three kinds of offer that carry it:
// an offer for a weapon not held, one for a passive not held, and the lamp-oil
// offer each draw `OFFER_NEW_TEXT`. The tag an offer for a HELD item carries is
// `offer-tag-level`'s point.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`levelup`, the offer table): "Tag | `OFFER_NEW_TEXT` (`NEW`)
//   for an item not yet held, else `LEVEL_LABEL` and the level it would become,
//   as `LEVEL 3`. Lamp oil is never held, so its tag is `NEW`."
//   specs/progression.md ("Choosing"): "a tag: `OFFER_NEW_TEXT` (`NEW`) for an
//   item not yet held".
//   specs/progression.md ("The draw"): "When the pool is empty the overlay
//   offers exactly one item, `LAMP_OIL_ID`".
//
// THE DRIVE, AND WHY ONE OFFER AT A TIME. Three scenes, each an isolated
// `playing` run whose overlay is opened by the tick a queued level-up opens it,
// and each overlay carries exactly ONE offer, which `setNextOffers` allows
// ("a list of `1` to `OFFER_COUNT` (`3`) distinct ids"). With one row on the
// screen the tag is read off the frame's text without reading any layout, and
// no other row can supply the word. The third scene fills every slot at its max
// level, which empties the pool, so lamp oil is offered on its own with nothing
// posed.
//
// THE TOLERANCE. The tag is matched as a whole token in the frame's text
// through `hasToken`, case ignored, so `NEW` inside a longer word does not
// count. Nothing about where a tag sits is read, since specs/ui.md fixes no
// layout for a row.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  BASE_WEAPON_IDS,
  LAMP_OIL_ID,
  MAX_WEAPON_LEVEL,
  OFFER_NEW_TEXT,
  PASSIVES,
  PASSIVE_IDS,
  PASSIVE_SLOTS,
  WEAPON_SLOTS,
  type OfferId,
  type PassiveId,
  type WeaponId,
} from "../constants";
import {
  captureStill,
  createHarness,
  hasToken,
  holdPassive,
  holdWeapon,
  isolate,
  openLevelUp,
  textReadings,
  type Harness,
} from "../harness";

let h: Harness;

/** Fill every slot of both kinds at its max, which empties the candidate pool. */
function fillEverySlot(harness: Harness): void {
  const weapons: readonly WeaponId[] = BASE_WEAPON_IDS.filter(
    (id) => id !== "lantern" && id !== "halo",
  ).slice(0, WEAPON_SLOTS);
  for (const id of weapons) holdWeapon(harness, id, MAX_WEAPON_LEVEL);
  const passives: readonly PassiveId[] = PASSIVE_IDS.slice(0, PASSIVE_SLOTS);
  for (const id of passives) holdPassive(harness, id, PASSIVES[id].maxLevel);
}

/** Open a one-offer overlay for `id` on an empty loadout and read its frame. */
async function offerAlone(harness: Harness, id: OfferId): Promise<boolean> {
  isolate(harness);
  harness.debug.setNextOffers([id]);
  const opened = await openLevelUp(harness, 1);
  assertDeepEqual(
    opened.run.offers,
    [id],
    `the offer the overlay presents for ${id}`,
  );
  const { calls } = await harness.frameDraw();
  return hasToken(textReadings(calls), OFFER_NEW_TEXT);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("tags a weapon, a passive, and lamp oil not held with NEW", async () => {
  assertEqual(
    await offerAlone(h, "ember"),
    true,
    `the tag on an offer for a weapon not held (${OFFER_NEW_TEXT})`,
  );
  captureStill(h, "new");

  assertEqual(
    await offerAlone(h, "glass"),
    true,
    `the tag on an offer for a passive not held (${OFFER_NEW_TEXT})`,
  );

  isolate(h);
  fillEverySlot(h);
  const oil = await openLevelUp(h, 1);
  assertDeepEqual(
    oil.run.offers,
    [LAMP_OIL_ID],
    "the offers drawn over an empty pool",
  );
  const { calls } = await h.frameDraw();
  assertEqual(
    hasToken(textReadings(calls), OFFER_NEW_TEXT),
    true,
    `the tag on the lamp-oil offer (${OFFER_NEW_TEXT})`,
  );
});
