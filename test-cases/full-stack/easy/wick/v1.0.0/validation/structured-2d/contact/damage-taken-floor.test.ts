// contact/damage-taken-floor — a contact hit removes at least
// MIN_DAMAGE_TAKEN whatever the armor.
//
// THE SPEC LINE. `specs/passives.md`, "Armor": "`damage taken =
// max(MIN_DAMAGE_TAKEN, enemy damage − armor)` with `MIN_DAMAGE_TAKEN` (`1`),
// so every contact hit that lands removes at least `1` health whatever the
// armor. Brass tops out at level `3`, so armor is at most `3`." A gnat's damage
// is `3` (`specs/enemies.md`), so with Brass `3` the subtraction is `0` and the
// floor makes the hit remove exactly `1`.
//
// WHY A GNAT AND BRASS 3. The one pairing in the tables where armor reaches
// the whole of an enemy's damage: the floor is what decides the figure, so a
// build without it removes `0` and reads as no hit at all, and a build that
// floors at `0` reads the same. `armor-reduces-hit` grades the subtraction
// above the floor with a rat; this grades the floor alone.
//
// THE POSE. Brass `3` through `setPassive`, then one gnat overlapping the
// lamplighter with its spawn cooldown of `0`. A gnat drifts on the heading it
// spawned with, but `enemyMotion` is off so it holds; `enemyContact` is on,
// and nothing else is in the world.
//
// THE TOLERANCE. `100 − 1`, held to `REAL_EPS`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import {
  ENEMIES,
  MIN_DAMAGE_TAKEN,
  PASSIVES,
  REAL_EPS,
  armorOf,
} from "../constants";
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

/** Brass at its max: armor 3. */
const BRASS = PASSIVES.brass.maxLevel;

/** The gnat's center distance: inside its `8 + 12` overlap bound. */
const OFFSET = 8;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("removes exactly 1 from hp when a gnat of damage 3 hits through armor 3", async () => {
  const armor = armorOf(BRASS);
  if (!(ENEMIES.gnat.damage - armor < MIN_DAMAGE_TAKEN)) {
    throw new Error("the scenario must put the hit under the floor");
  }

  const before = isolate(h);
  holdPassive(h, "brass", BRASS);
  assertEqual(
    h.snapshot().run.armor,
    armor,
    "armor read back with Brass 3 held (specs/passives.md, Armor)",
  );
  placeEnemyNear(h, "gnat", OFFSET, 0);
  enable(h, "enemyContact");

  const after = await advanceTicks(h, 1);
  captureStill(h, "floor");

  assertNear(
    after.run.player.hp,
    before.run.player.hp - MIN_DAMAGE_TAKEN,
    REAL_EPS,
    `hp after a gnat's hit of ${ENEMIES.gnat.damage} against armor ${armor} (specs/passives.md, Armor)`,
  );
});
