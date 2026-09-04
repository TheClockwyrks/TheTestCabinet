// Wick — evolutions/chest-fallback-heal: a chest with nothing to evolve and
// nothing to level heals `CHEST_HEAL`.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Opening a chest"),
// rule 3: "`hp` rises by `CHEST_HEAL` (`30`), capped at `maxHp`. The result is
// `{ kind: "heal" }`." With Taper at `MAX_WEAPON_LEVEL` (`8`) and no Wick, rule
// 1 finds nothing eligible, and with Brass at its max of `3`
// (`specs/passives.md`) and Taper at its own, rule 2 finds no item "below its
// max level". `maxHp` is `BASE_MAX_HP` (`100`) with no Tallow held
// (`specs/passives.md`), and `recovery` is `BASE_RECOVERY` (`0`) with no Tinder,
// so nothing else moves `hp` on the tick. So from `hp` `50` the chest leaves
// `80`, under the cap, and reports a heal.
//
// THE POSE. An isolated night with Taper at level 8 and Brass at level 3, `hp`
// posed to 50 through `setHp`, and the chest reached the real way through the
// harness's `openChest`. `enemyContact` is off and nothing is alive, so no hit
// lands on the tick.
//
// TOLERANCE. `FLOAT_TOL` on `hp`, a real number the heal adds a whole `30` to;
// the result's kind is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import {
  BASE_MAX_HP,
  CHEST_HEAL,
  FLOAT_TOL,
  MAX_WEAPON_LEVEL,
  PASSIVES,
} from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  openChest,
  player,
  type Harness,
} from "../harness";
import { chestOutcome } from "./stage";

/** The health the run is posed at: `CHEST_HEAL` below the cap and more. */
const POSED_HP = 50;

/** Brass at its max, so no held item is below its max level. */
const BRASS_LEVEL = PASSIVES.brass.maxLevel;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises hp from 50 to 80 and reports a heal with every held item at its max", async () => {
  await isolate(h);
  await holdWeapon(h, "taper", MAX_WEAPON_LEVEL, 0);
  await holdPassive(h, "brass", BRASS_LEVEL, 0);
  await h.debug.setHp(POSED_HP);
  const posed = await h.snapshot();
  assertEqual(posed.run.maxHp, BASE_MAX_HP, "maxHp with no Tallow held");
  assertNear(player(posed).hp, POSED_HP, FLOAT_TOL, "hp as posed");

  const opened = await openChest(h);
  await captureStill(h, "healed");

  const result = chestOutcome(opened, "the chest with every held item maxed");
  assertEqual(result.kind, "heal", "the chest result's kind");
  assertNear(
    player(opened).hp,
    POSED_HP + CHEST_HEAL,
    FLOAT_TOL,
    "hp after the chest healed",
  );
});
