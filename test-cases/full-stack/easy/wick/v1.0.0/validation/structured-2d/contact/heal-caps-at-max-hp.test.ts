// contact/heal-caps-at-max-hp — every heal caps hp at the maxHp in force.
//
// THE SPEC LINE. `specs/world.md`, "Health and recovery": "Every heal from any
// source, bread, lamp-oil, a chest, or a weapon, adds to `hp` and caps it at
// the `maxHp` in force when the heal is applied." The three heals a pose can
// reach each carry `30`: bread "Heals `BREAD_HEAL` (`30`), capped at `maxHp`"
// (Pickups); lamp oil "`hp` rises by `LAMP_OIL_HEAL`, capped at `maxHp`"
// (`specs/progression.md`, Choosing); a chest with nothing to evolve or level
// "`hp` rises by `CHEST_HEAL` (`30`), capped at `maxHp`" (`specs/evolutions.md`,
// Opening a chest). From `hp` `90` with `maxHp` `100` each lands at exactly
// `100`, not `120`.
//
// WHY THREE HEALS IN ONE POINT. The requirement is ONE rule, "caps it at the
// `maxHp` in force", stated once over every source; a build that caps one
// source and not another has missed that rule, and this point is the one
// that says so. The weapon heals (Pyre, Corona) are the one source left to
// their own weapon points, since reaching them means a kill.
//
// WHY 90. Ten short of the cap and thirty is the heal, so an uncapped build
// reads `120` and a build that caps reads `100`; a start of `70` would read
// `100` either way and decide nothing.
//
// THE POSES. Three fresh isolated worlds, so each heal is read on its own:
//   - bread: `hp` `90`, a bread posed at the lamplighter's center, one tick
//     (phase 8 collects it: its center is within `PICKUP_ITEM_RADIUS +
//     PLAYER_RADIUS`).
//   - lamp oil: the loadout `loadout.ts` describes, which leaves the pool
//     empty so the overlay "offers exactly one item, `LAMP_OIL_ID`"; `hp` `90`;
//     the overlay opened the way a gain opens it and the offer accepted
//     through `choose`, which "accepts the offer at `index` … exactly as
//     moving the highlight there and pressing `confirm` would".
//   - chest: the same loadout so the chest's first two rules find nothing and
//     the third heals; `hp` `90`; a chest at the center, one tick.
// No Tallow is held anywhere so `maxHp` is `BASE_MAX_HP`, and no Tinder so
// nothing but the heal moves `hp`.
//
// THE TOLERANCE. A capped heal yields `maxHp` itself, so each reading is
// compared with `Object.is`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  BASE_MAX_HP,
  BREAD_HEAL,
  CHEST_HEAL,
  LAMP_OIL_HEAL,
  LAMP_OIL_ID,
} from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  openChest,
  openLevelUp,
  placePickup,
  type Harness,
} from "../harness";
import { holdMaxedLoadout } from "./loadout";

/** Where hp starts before each heal: inside the heal of the cap by twenty. */
const START_HP = 90;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("caps bread, lamp oil, and a chest heal at maxHp 100 from hp 90", async () => {
  for (const heal of [BREAD_HEAL, LAMP_OIL_HEAL, CHEST_HEAL]) {
    if (!(START_HP + heal > BASE_MAX_HP)) {
      throw new Error("each heal must overshoot the cap to decide anything");
    }
  }

  // Bread.
  isolate(h);
  assertEqual(h.snapshot().run.maxHp, BASE_MAX_HP, "maxHp with no Tallow held");
  h.debug.setHp(START_HP);
  const { player } = h.snapshot().run;
  placePickup(h, "bread", player.x, player.y);
  const fed = await advanceTicks(h, 1);
  assertEqual(
    fed.run.pickups.length,
    0,
    "the bread at the lamplighter's center was collected (specs/world.md, Collection)",
  );
  assertEqual(
    fed.run.player.hp,
    BASE_MAX_HP,
    `hp after bread's heal of ${BREAD_HEAL} from ${START_HP} (specs/world.md, Pickups)`,
  );

  // Lamp oil.
  isolate(h);
  holdMaxedLoadout(h);
  h.debug.setHp(START_HP);
  const overlay = await openLevelUp(h);
  assertEqual(overlay.screen, "levelup", "the level-up overlay opened");
  assertDeepEqual(
    overlay.run.offers,
    [LAMP_OIL_ID],
    "the one offer over an empty pool (specs/progression.md, The draw)",
  );
  h.debug.choose(0);
  const oiled = h.snapshot();
  assertEqual(
    oiled.run.player.hp,
    BASE_MAX_HP,
    `hp after lamp oil's heal of ${LAMP_OIL_HEAL} from ${START_HP} (specs/progression.md, Choosing)`,
  );

  // A chest.
  isolate(h);
  holdMaxedLoadout(h);
  h.debug.setHp(START_HP);
  const opened = await openChest(h);
  captureStill(h, "capped");
  assertDeepEqual(
    opened.run.chestResult,
    { kind: "heal" },
    "the chest's result with nothing to evolve or level (specs/evolutions.md, Opening a chest)",
  );
  assertEqual(
    opened.run.player.hp,
    BASE_MAX_HP,
    `hp after a chest's heal of ${CHEST_HEAL} from ${START_HP} (specs/evolutions.md, Opening a chest)`,
  );
});
