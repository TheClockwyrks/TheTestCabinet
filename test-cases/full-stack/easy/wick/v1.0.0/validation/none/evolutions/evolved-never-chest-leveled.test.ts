// Wick — evolutions/evolved-never-chest-leveled: a chest never levels an
// evolved weapon.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("What an evolution
// is"): "An evolved weapon has a single level and no level table: its figures
// are one fixed row ... and it is never leveled further. It is never a level-up
// offer, and it is never the item a chest levels." So with Pyre held alone,
// rule 1 of "Opening a chest" finds no BASE weapon to evolve, rule 2 finds no
// item "below its max level" — Pyre is not a candidate at all — and rule 3
// applies: "`hp` rises by `CHEST_HEAL` (`30`), capped at `maxHp`. The result is
// `{ kind: "heal" }`." `maxHp` is `BASE_MAX_HP` (`100`) with no Tallow held, so
// from `hp` `50` the chest leaves `80`, and Pyre still reads level `1`.
//
// THE POSE. An isolated night with Pyre alone in slot 0 through `setWeapon`
// (`level` is "`1` for an evolved one", `specs/instrumentation.md`), no passive
// held, `hp` posed to 50, and the chest reached the real way through the
// harness's `openChest`.
//
// TOLERANCE. `FLOAT_TOL` on `hp`; the result's kind and Pyre's level are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { CHEST_HEAL, FLOAT_TOL } from "../constants";
import {
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  openChest,
  player,
  type Harness,
} from "../harness";
import { chestOutcome, slotOf } from "./stage";

/** The health the run is posed at: `CHEST_HEAL` below the cap and more. */
const POSED_HP = 50;

/** The slot Pyre is posed in. */
const SLOT = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("heals rather than leveling the Pyre held alone, leaving it at level 1", async () => {
  await isolate(h);
  await holdWeapon(h, "pyre", 1, SLOT);
  await h.debug.setHp(POSED_HP);

  const opened = await openChest(h);
  await captureStill(h, "skipped");

  const result = chestOutcome(opened, "the chest with Pyre held alone");
  assertEqual(result.kind, "heal", "the chest result's kind");
  assertNear(
    player(opened).hp,
    POSED_HP + CHEST_HEAL,
    FLOAT_TOL,
    "hp after the chest healed",
  );
  const slot = slotOf(opened, SLOT, "after the chest");
  assertEqual(slot.id, "pyre", "the weapon in the slot after the chest");
  assertEqual(slot.level, 1, "Pyre's level after the chest");
});
