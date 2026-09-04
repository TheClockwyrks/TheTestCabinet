// economy — the two price tables as a check reads them.
//
// Not a suite: the lookups several of them share. `specs/upgrades.md` holds one
// ladder for the six five-tier tracks, indexed by the tier being LEFT, and gives
// the scanner the first two rungs of the same ladder; `specs/items.md` prices the
// six field supplies. `../constants` transcribes both from those specs, so nothing
// here is a figure of its own — each is only the arithmetic that turns the tier or
// the id into the price the specification prints.

import { ITEMS, MAX_TIER, UPGRADE_PRICES } from "../constants";
import type { ItemId, UpgradeTrack } from "../harness";

/** What buying `tier` on `track` costs, or `null` where the track is maxed out. */
export function upgradePrice(track: UpgradeTrack, tier: number): number | null {
  if (tier < 2 || tier > MAX_TIER[track]) return null;
  return UPGRADE_PRICES[tier - 2];
}

/** What one of each field supply costs, as `specs/items.md` prices them. */
export const ITEM_PRICE = Object.fromEntries(
  ITEMS.map((item) => [item.id, item.price]),
) as Record<ItemId, number>;
