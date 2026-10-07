// evolutions/evolved-never-chest-leveled — a chest never levels an evolved
// weapon.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("What an evolution
// is"): "An evolved weapon has a single level and no level table: its figures
// are one fixed row ... and it is never leveled further. It is never a
// level-up offer, and it is never the item a chest levels." Rule 2 of
// ("Opening a chest") reaches "One held item below its max level, a base
// weapon below `MAX_WEAPON_LEVEL` or a passive below its own max", and Pyre is
// neither. With Pyre the only thing held, rule 1 finds no base weapon and rule
// 2 no candidate, so rule 3 applies: "`hp` rises by `CHEST_HEAL` (`30`),
// capped at `maxHp`. The result is `{ kind: "heal" }`." With `hp` posed to 50
// against a `maxHp` of `BASE_MAX_HP` (`100`) — no Tallow held — `hp` reads 80
// and Pyre still reads level 1.
//
// WHY THE HEAL IS READ TOO. A build that levelled Pyre would report a level
// result rather than a heal, and one that counted Pyre as a candidate and then
// declined to raise it would report a level result naming it; reading the
// result, the `hp`, and Pyre's level together fails each of those and passes
// only the build that passed Pyre over entirely.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding Pyre alone —
// `setWeapon` takes an evolved weapon at "`1`" (`specs/instrumentation.md`) —
// with no passive, every driver switch off, so the tick that collects the
// chest fires nothing and moves nothing, and no other item can be the one the
// chest levels. No Tinder is held, so `recovery` is `BASE_RECOVERY` (`0`) and
// nothing but the chest changes `hp`.
//
// THE TOLERANCE. `REAL_EPS` on `hp`, one addition of two reals; the result and
// the slot are read exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNear } from "../assert";
import { BASE_MAX_HP, CHEST_HEAL, REAL_EPS } from "../constants";
import {
  captureStill,
  createHarness,
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

it("heals rather than levelling the Pyre held alone, which still reads level 1", async () => {
  if (!(POSED_HP + CHEST_HEAL <= BASE_MAX_HP)) {
    throw new Error("the heal must fit under maxHp");
  }

  isolate(h);
  const slot = holdWeapon(h, "pyre", 1);
  h.debug.setHp(POSED_HP);

  const after = await openChest(h);
  captureStill(h, "skipped");

  assertDeepEqual(
    after.run.chestResult,
    { kind: "heal" },
    "the chest's result with only an evolved weapon held (specs/evolutions.md, What an evolution is)",
  );
  assertEqual(
    after.run.weapons[slot]?.level,
    1,
    "Pyre's level after the chest, the single level an evolved weapon has (specs/evolutions.md, What an evolution is)",
  );
  assertNear(
    after.run.player.hp,
    POSED_HP + CHEST_HEAL,
    REAL_EPS,
    `hp after the chest, ${CHEST_HEAL} above the ${POSED_HP} it was posed at (specs/evolutions.md, Opening a chest)`,
  );
});
