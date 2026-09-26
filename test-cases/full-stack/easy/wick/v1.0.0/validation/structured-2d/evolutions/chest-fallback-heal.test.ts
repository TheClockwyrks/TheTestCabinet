// evolutions/chest-fallback-heal — a chest with nothing to level heals
// CHEST_HEAL.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Opening a chest"),
// rule 3: "`hp` rises by `CHEST_HEAL` (`30`), capped at `maxHp`. The result is
// `{ kind: "heal" }`." Rule 1 finds nothing: Taper is at `MAX_WEAPON_LEVEL`
// with no Wick held, and "A base weapon with no recipe never evolves: at
// `MAX_WEAPON_LEVEL` a chest passes it over". Rule 2 finds nothing: no held
// item is below its max, Taper at 8 and Brass at 3, Brass's own max
// (`specs/passives.md`). So with `hp` posed to 50 against a `maxHp` of
// `BASE_MAX_HP` (`100`) — no Tallow is held — the chest leaves `hp` at 80,
// short of the cap, and reports the heal.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding a maxed weapon and
// a maxed passive and nothing else, every driver switch off. `hp` is posed
// through `setHp`, "a real number at most `maxHp`" (`specs/instrumentation.md`),
// far enough below the cap that the whole heal fits, so what is read is the
// heal's size rather than the cap; no Tinder is held, so `recovery` is
// `BASE_RECOVERY` (`0`) and the tick's recovery step adds nothing
// (`specs/world.md`, Health and recovery); and nothing can hit the lamplighter
// with `enemyContact` off and no enemy in the world.
//
// THE TOLERANCE. `REAL_EPS` on `hp`, one addition of two reals; the result is
// compared structurally.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNear } from "../assert";
import {
  BASE_MAX_HP,
  CHEST_HEAL,
  MAX_WEAPON_LEVEL,
  PASSIVES,
  REAL_EPS,
} from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  openChest,
  type Harness,
} from "../harness";

/** The `hp` posed: low enough that the whole heal fits under `maxHp`. */
const POSED_HP = 50;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("raises hp from 50 to 80 and reports a heal result", async () => {
  if (!(POSED_HP + CHEST_HEAL <= BASE_MAX_HP)) {
    throw new Error("the heal must fit under maxHp");
  }

  isolate(h);
  holdWeapon(h, "taper", MAX_WEAPON_LEVEL);
  holdPassive(h, "brass", PASSIVES.brass.maxLevel);
  h.debug.setHp(POSED_HP);

  const after = await openChest(h);
  captureStill(h, "healed");

  assertNear(
    after.run.player.hp,
    POSED_HP + CHEST_HEAL,
    REAL_EPS,
    `hp after the chest, ${CHEST_HEAL} above the ${POSED_HP} it was posed at (specs/evolutions.md, Opening a chest)`,
  );
  assertDeepEqual(
    after.run.chestResult,
    { kind: "heal" },
    "the chest's result with every held item at its max (specs/evolutions.md, Opening a chest)",
  );
});
