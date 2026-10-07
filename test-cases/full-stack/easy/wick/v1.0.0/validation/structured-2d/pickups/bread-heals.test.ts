// pickups/bread-heals — bread heals BREAD_HEAL on collection.
//
// WHERE THE THRESHOLD COMES FROM. `specs/world.md` ("Pickups") lists what bread
// does: "Heals `BREAD_HEAL` (`30`), capped at `maxHp`", and ("Health and
// recovery"): "Every heal from any source, bread, lamp-oil, a chest, or a
// weapon, adds to `hp` and caps it at the `maxHp` in force when the heal is
// applied." `maxHp` is `BASE_MAX_HP` (`100`) with no Tallow held. So from
// `POSED_HP` (`50`), collecting one bread reads `hp` `80`, under the cap, so
// the figure read is the whole heal rather than the cap.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing else dropped, and no slot held. No Tallow, so `maxHp`
// is the base figure and `50 + 30` stays under it; no Tinder, so `recovery` is
// `BASE_RECOVERY` (`0`) and the tick's recovery adds nothing to `hp` beside the
// heal; `enemyContact` off with nothing alive, so nothing takes any away. The
// bread is posed on the lamplighter's center, at distance `0`, and collected by
// one real tick, the only path a bread's heal arrives by.
//
// THE TOLERANCE. `REAL_EPS` on `hp`, "a real number at most `maxHp`".

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { BASE_MAX_HP, BREAD_HEAL, REAL_EPS } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  placePickup,
  type Harness,
} from "../harness";

/** Low enough that the whole `BREAD_HEAL` fits under `BASE_MAX_HP` (`100`). */
const POSED_HP = 50;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("raises hp by BREAD_HEAL when bread is collected under the cap", async () => {
  const opened = isolate(h);
  assertNear(
    opened.run.maxHp,
    BASE_MAX_HP,
    REAL_EPS,
    "the maximum health with no Tallow held",
  );
  h.debug.setHp(POSED_HP);
  const at = opened.run.player;
  placePickup(h, "bread", at.x, at.y);

  const after = await advanceTicks(h, 1);
  captureStill(h, "bread");

  assertEqual(after.run.pickups.length, 0, "the pickups left after the tick");
  assertNear(
    after.run.player.hp,
    POSED_HP + BREAD_HEAL,
    REAL_EPS,
    "the health after the bread was collected (specs/world.md, Pickups)",
  );
});
