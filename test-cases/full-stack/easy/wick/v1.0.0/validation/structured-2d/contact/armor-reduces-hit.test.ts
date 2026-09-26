// contact/armor-reduces-hit — armor takes its level off every contact hit.
//
// THE SPEC LINE. `specs/passives.md`, "Armor": "Armor is a flat reduction to
// each contact hit the lamplighter takes: `damage taken = max(MIN_DAMAGE_TAKEN,
// enemy damage − armor)`", with `armor = BRASS_ARMOR_PER_LEVEL × brass` and
// `BRASS_ARMOR_PER_LEVEL` `1` from the same file's tables. A rat's damage is
// `8` (`specs/enemies.md`), so with Brass held at level `2` the hit removes
// `8 − 2 = 6`.
//
// WHY BRASS 2 AND A RAT. Two is a level with something on either side of it
// (Brass runs `1` to `3`), so a build that reads a flat `1` per Brass held, or
// the max level, gives a different figure. A rat's `8` keeps the difference
// well above the `MIN_DAMAGE_TAKEN` floor, so the floor never enters into it;
// the floor is `damage-taken-floor`'s point.
//
// THE POSE. Brass placed through `setPassive`, which leaves `hp` untouched and
// has `armor` "follow from the next read" (`specs/instrumentation.md`), then a
// rat overlapping the lamplighter with its spawn cooldown of `0` so it hits on
// the next tick. `enemyMotion` off, `enemyContact` on, nothing else.
//
// THE TOLERANCE. `100 − 6`, held to `REAL_EPS`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { ENEMIES, MIN_DAMAGE_TAKEN, REAL_EPS, armorOf } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  enable,
  holdPassive,
  isolate,
  placeEnemyNear,
  type Harness,
} from "../harness";

/** The Brass level held. */
const BRASS = 2;

/** The rat's center distance: inside its `12 + 12` overlap bound. */
const OFFSET = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("removes 8 − 2 = 6 from hp when a rat hits with Brass 2 held", async () => {
  const armor = armorOf(BRASS);
  const expectedTaken = Math.max(MIN_DAMAGE_TAKEN, ENEMIES.rat.damage - armor);
  if (expectedTaken !== ENEMIES.rat.damage - armor) {
    throw new Error("the scenario must keep the hit above the floor");
  }

  const before = isolate(h);
  holdPassive(h, "brass", BRASS);
  assertEqual(
    h.snapshot().run.armor,
    armor,
    "armor read back with Brass 2 held (specs/passives.md, Armor)",
  );
  placeEnemyNear(h, "rat", OFFSET, 0);
  enable(h, "enemyContact");

  const after = await advanceTicks(h, 1);
  captureStill(h, "armored");

  assertNear(
    after.run.player.hp,
    before.run.player.hp - expectedTaken,
    REAL_EPS,
    `hp after a rat's hit of ${ENEMIES.rat.damage} against armor ${armor} (specs/passives.md, Armor)`,
  );
});
