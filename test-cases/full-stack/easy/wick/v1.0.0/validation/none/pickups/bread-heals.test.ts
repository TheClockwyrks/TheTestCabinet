// pickups/bread-heals — bread heals BREAD_HEAL on collection.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Pickups") lists what bread
// does: "Heals `BREAD_HEAL` (`30`), capped at `maxHp`", and ("Health and
// recovery"): "Every heal from any source, bread, lamp-oil, a chest, or a
// weapon, adds to `hp` and caps it at the `maxHp` in force when the heal is
// applied." `maxHp` is `BASE_MAX_HP` (`100`) with no Tallow held. So from
// `POSED_HP` (`50`), collecting one bread reads `hp` `80`, which is under the
// cap, so the figure read is the whole heal rather than the cap.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing else dropped, and no slot held. No Tallow, so `maxHp`
// is the base figure and `50 + 30` stays under it; no Tinder, so `recovery` is
// `BASE_RECOVERY` (`0`) and phase 3 of the tick adds nothing to `hp` beside the
// heal; `enemyContact` off and nothing alive, so nothing takes any away. The
// bread is posed on the lamplighter's center, at distance `0`, and collected by
// one real tick, which is the only path a bread's heal arrives by.
//
// THE TOLERANCE. `FLOAT_TOL` on `hp`, "a real number at most `maxHp`".

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { BASE_MAX_HP, BREAD_HEAL, FLOAT_TOL } from "../constants";
import {
  captureStill,
  collectPickup,
  createHarness,
  isolate,
  player,
  type Harness,
} from "../harness";

/** Low enough that the whole `BREAD_HEAL` fits under `BASE_MAX_HP` (`100`). */
const POSED_HP = 50;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises hp by BREAD_HEAL when bread is collected under the cap", async () => {
  const opened = await isolate(h);
  assertNear(
    opened.run.maxHp,
    BASE_MAX_HP,
    FLOAT_TOL,
    "the maximum health with no Tallow held",
  );
  await h.debug.setHp(POSED_HP);

  const after = await collectPickup(h, "bread");
  await captureStill(h, "bread");

  assertEqual(after.run.pickups.length, 0, "the pickups left after the tick");
  assertNear(
    player(after).hp,
    POSED_HP + BREAD_HEAL,
    FLOAT_TOL,
    "the health after the bread was collected",
  );
});
