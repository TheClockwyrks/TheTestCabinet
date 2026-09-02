// Wick — enemies/dark-takes-other-damage: every weapon but Flare hurts the Dark
// like any enemy.
//
// WHERE THE THRESHOLD COMES FROM. `specs/enemies.md` ("Elites and the Dark"):
// "Every other weapon damages the Dark exactly as it damages any enemy", the
// sentence that follows `FLARE_IMMUNE`. `specs/weapons.md` ("Hits and death"):
// "A hit removes the shape's damage per hit from the enemy's `hp`", and row 1
// of `EMBER_LEVELS` gives a bolt `10` damage, which ("Derived stats") is the
// "table value x `damageMul`", `1` with no passive held. The Dark's row gives
// it `10000` health ("The Dark | `dark` | `dark` | 10000 | 170 | 50 | 40 |
// nothing | chase"), which "Elites and the Dark spawn with their table HP as
// `maxHp`, unscaled" leaves alone at any clock. So one bolt leaves `9990`.
//
// THE POSE. An isolated night holding nothing but the lamplighter and one Dark
// at `(150, 0)`, with a level-1 Ember bolt posed on its center — a bolt
// "hit[s] at the position it was created at" (`specs/world.md`, phase 6), and
// its radius `8` against the Dark's `40` overlaps at a distance of zero
// whichever way a build tests it. Every faculty is held, so the tick's whole
// content is the hit: nothing moves, nothing else fires, and the Dark stands
// where it was posed.
//
// TOLERANCE. `FLOAT_TOL` on the Dark's hp, `10000` less `10`. The wrong answer
// an immunity would give, the full `10000`, is ten units away.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { ENEMIES, FLOAT_TOL } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  mustEnemy,
  placeEnemy,
  placeProjectile,
  type Harness,
} from "../harness";
import { BOLT_DAMAGE, KILL_AT } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes an Ember bolt's 10 from the Dark's 10000", async () => {
  await isolate(h);
  const dark = await placeEnemy(h, "dark", KILL_AT.x, KILL_AT.y);
  await placeProjectile(h, "ember", KILL_AT.x, KILL_AT.y, 0, 0, 0);

  const after = await h.step(1);
  await captureStill(h, "hit");

  assertNear(
    mustEnemy(after, dark.id).hp,
    ENEMIES.dark.hp - BOLT_DAMAGE,
    FLOAT_TOL,
    "the Dark's hp after one Ember bolt",
  );
});
