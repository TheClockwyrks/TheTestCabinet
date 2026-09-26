// screens/offer-shows-name — each offer shows its item's name.
//
// WHAT THIS DECIDES. One thing, over the three kinds of thing an overlay can
// offer: the frame carries the name the specification gives the offered item, a
// weapon's from `WEAPON_NAMES`, a passive's from `PASSIVES`, and lamp oil's
// `LAMP_OIL_NAME`. The three share one point because they exercise one rule the
// same way.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`levelup`, the offer table): "Name | The weapon's name from
//   `WEAPON_NAMES`, the passive's from `PASSIVES`, or `LAMP_OIL_NAME`
//   (`Lamp Oil`)."
//   specs/progression.md ("Choosing"): "Each offer shows the item's icon, its
//   display name, and a tag".
//   specs/progression.md ("The draw"): "When the pool is empty the overlay
//   offers exactly one item, `LAMP_OIL_ID`, which fills no slot."
//   specs/progression.md ("The candidate pool"): a pool is empty when no held
//   item is below its max level and no slot of either kind is free, which is
//   how the lamp-oil offer is reached.
//
// THE DRIVE. Two scenes, each an isolated `playing` run whose overlay is opened
// by the tick a queued level-up opens it. The first holds nothing, so every
// weapon and every passive is a candidate and the three named ids are accepted
// by `setNextOffers`; the second fills all `WEAPON_SLOTS` at `MAX_WEAPON_LEVEL`
// and all `PASSIVE_SLOTS` at each passive's own max, which empties the pool, so
// the overlay draws lamp oil on its own with nothing posed.
//
// THE TOLERANCE. Each name is matched as a substring of a run of drawn text
// through the shared harness's `drewText`, ignoring case and whitespace, which
// admits any font, spacing, and marker a build draws around it and refuses a
// build that shows an id or another name.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  BASE_WEAPON_IDS,
  LAMP_OIL_ID,
  LAMP_OIL_NAME,
  MAX_WEAPON_LEVEL,
  PASSIVES,
  PASSIVE_IDS,
  PASSIVE_SLOTS,
  WEAPON_NAMES,
  WEAPON_SLOTS,
  type PassiveId,
  type WeaponId,
} from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";
import { drewText } from "../case-harness/text";

let h: Harness;

/** A weapon and two passives, all candidates of an empty loadout's pool. */
const OFFERS = ["ember", "glass", "tallow"] as const;
const NAMES = [WEAPON_NAMES.ember, PASSIVES.glass.name, PASSIVES.tallow.name];

/**
 * Fill every slot of both kinds at its max level, which empties the candidate
 * pool: no held item is below its max and no slot is free. The weapons chosen
 * are the ones that place no aura and no lantern set, so the tick that opens
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

it("draws the weapon's, the passive's, and lamp oil's names", async () => {
  isolate(h);
  h.debug.setNextOffers([...OFFERS]);
  const opened = await openLevelUp(h, 1);
  assertDeepEqual(
    opened.run.offers,
    [...OFFERS],
    "the offers the overlay presents",
  );

  const { calls } = await h.frameDraw();
  captureStill(h, "names");
  assertDeepEqual(
    NAMES.filter((name) => !drewText(calls, name)),
    [],
    "the names specs/ui.md gives the offered items, missing from the overlay",
  );

  isolate(h);
  fillEverySlot(h);
  const oil = await openLevelUp(h, 1);
  assertEqual(
    oil.screen,
    "levelup",
    "the screen the second queued level-up opened",
  );
  assertDeepEqual(oil.run.pool, [], "the candidate pool of a filled loadout");
  assertDeepEqual(
    oil.run.offers,
    [LAMP_OIL_ID],
    "the offers drawn over an empty pool",
  );

  const { calls: oilCalls } = await h.frameDraw();
  assertEqual(
    drewText(oilCalls, LAMP_OIL_NAME),
    true,
    `the lamp-oil offer draws ${LAMP_OIL_NAME}`,
  );
});
