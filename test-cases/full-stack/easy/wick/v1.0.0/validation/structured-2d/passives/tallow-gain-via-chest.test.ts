// passives/tallow-gain-via-chest — a Tallow level granted by a chest raises
// `hp` by `TALLOW_HP_PER_LEVEL` too.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md`, Max health: "Each time
// Tallow rises by one level ... and through whichever path grants it, the
// lamplighter's current `hp` rises by `TALLOW_HP_PER_LEVEL` on the same tick
// that `maxHp` does." The chest is one such path: `specs/evolutions.md`
// (Opening a chest) makes its second rule "One held item below its max level,
// a base weapon below `MAX_WEAPON_LEVEL` or a passive below its own max, is
// chosen uniformly at random from the game's seeded generator and rises by
// `1`, exactly as accepting a `+1 level` offer does." With Tallow at `1` and
// `maxHp` `115`, the level makes both `130`.
//
// WHY THE RESULT IS NOT A DRAW. The run holds no weapon at all, so the chest's
// first rule, an evolution, needs a base weapon at `MAX_WEAPON_LEVEL` and
// finds none, and its second rule draws from a set of one: Tallow at level `1`
// is the only held item below its max. A build that reached the heal rule
// instead is a different failure and is caught by the same reading.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding Tallow 1 alone,
// with `hp` posed to `115`, the maximum that level gives, so the fifteen the
// level adds is visible rather than capped away. `openChest` places one chest
// at the lamplighter's center, inside the `28` unit collection distance
// (`specs/world.md`, Collection), and runs the one tick that collects it and
// applies its result (`specs/progression.md`, The chest overlay). Every driver
// switch is off, so nothing else touches `hp` on that tick.
//
// THE TOLERANCE. `REAL_EPS` on `hp` and `maxHp`, sums of whole figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNear } from "../assert";
import { REAL_EPS, maxHpOf } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  openChest,
  type Harness,
} from "../harness";

/** The Tallow level held before the chest, and the one it becomes. */
const BEFORE = 1;
const AFTER = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("raises hp and maxHp to 130 when a chest levels Tallow from 1 to 2", async () => {
  isolate(h);
  holdPassive(h, "tallow", BEFORE);
  h.debug.setHp(maxHpOf(BEFORE));
  const posed = h.snapshot();
  assertDeepEqual(
    posed.run.weapons,
    [],
    "the weapons held before the chest, so no evolution is eligible (specs/evolutions.md)",
  );

  const opened = await openChest(h);
  captureStill(h, "chest");

  assertEqual(
    opened.screen,
    "chest",
    "the screen the tick that collected the chest ended on (specs/progression.md)",
  );
  assertDeepEqual(
    opened.run.chestResult,
    { kind: "level", item: "tallow", level: AFTER },
    "the chest's result with Tallow the only item below its max (specs/evolutions.md, Opening a chest)",
  );
  assertNear(
    opened.run.maxHp,
    maxHpOf(AFTER),
    REAL_EPS,
    "maxHp after the chest leveled Tallow (specs/passives.md, Max health)",
  );
  assertNear(
    opened.run.player.hp,
    maxHpOf(AFTER),
    REAL_EPS,
    "hp on the tick the chest leveled Tallow (specs/passives.md, Max health)",
  );
});
