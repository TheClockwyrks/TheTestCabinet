// Wick — contact/lamp-oil-heal-caps: lamp oil accepted at hp 90 leaves hp at exactly maxHp.
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
//
// The other heals are `contact/bread-heal-caps`, `contact/chest-heal-caps`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { BASE_MAX_HP, LAMP_OIL_HEAL, LAMP_OIL_ID } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";
import { holdMaxedLoadout } from "./loadout";

/** Where hp starts before the heal: inside the heal of the cap by twenty. */
const START_HP = 90;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("caps lamp oil's heal at maxHp 100 from hp 90", async () => {
  if (!(START_HP + LAMP_OIL_HEAL > BASE_MAX_HP)) {
    throw new Error("the heal must overshoot the cap to decide anything");
  }

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
  captureStill(h, "capped");

  assertEqual(
    oiled.run.player.hp,
    BASE_MAX_HP,
    `hp after lamp oil's heal of ${LAMP_OIL_HEAL} from ${START_HP} (specs/progression.md, Choosing)`,
  );
});
