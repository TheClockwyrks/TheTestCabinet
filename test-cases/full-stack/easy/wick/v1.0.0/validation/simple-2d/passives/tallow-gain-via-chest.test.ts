// passives/tallow-gain-via-chest — a Tallow level a chest grants raises current
// health by 15 as well, the same as one taken from the overlay.
//
// WHERE THE THRESHOLD COMES FROM. specs/passives.md ("Max health"): "Each time
// Tallow rises by one level, whether it is gained at level 1 or leveled from
// any level below its max, and through whichever path grants it, the
// lamplighter's current `hp` rises by TALLOW_HP_PER_LEVEL on the same tick that
// `maxHp` does", with TALLOW_HP_PER_LEVEL 15 and
// maxHp = BASE_MAX_HP (100) + 15 × tallow. specs/evolutions.md ("Opening a
// chest") gives the second rule: "One held item below its max level, a base
// weapon below MAX_WEAPON_LEVEL or a passive below its own max, is chosen
// uniformly at random from the game's seeded generator and rises by 1, exactly
// as accepting a `+1 level` offer does. The result is
// { kind: "level", item, level }, with `level` the level it became." So from
// Tallow 1 and hp 115, the chest reads hp 130 and maxHp 130.
//
// THE WORLD. An isolated playing run: nothing on the field, NO weapon held, and
// Tallow alone at level 1 in the first passive slot, so Tallow is the only item
// below its max and the random choice has exactly one candidate; with no weapon
// held at all, the evolution rule that precedes it cannot apply. hp is posed to
// 115, the maximum Tallow 1 gives, so the raise is read rather than a heal to a
// cap. The chest is collected the real way, one chest placed at the
// lamplighter's center and one tick, which specs/instrumentation.md names as
// "the real collection path".
//
// WHAT IS READ. `chestResult` after the collecting tick, the Tallow level it
// names, and `hp` and `maxHp`, both 130, read with no tick between the chest
// and the reading.
//
// TOLERANCE. FIGURE_TOLERANCE (1e-9) on the health figures, sums of stated
// figures read back as doubles. None on the result, which is a literal.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertWithin } from "../assert";
import { FIGURE_TOLERANCE, derived, type HeldPassives } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openChest,
  type Harness,
} from "../harness";
import { holdPassives } from "./night";

/** The only item below its max when the chest opens: Tallow at level 1. */
const HELD: HeldPassives = { tallow: 1 };

/** 100 + 15 × 1 = 115, the health the chest is opened at. */
const BEFORE = derived.maxHp(HELD);

/** 100 + 15 × 2 = 130. */
const AFTER = derived.maxHp({ tallow: 2 } satisfies HeldPassives);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("raises hp and maxHp to 130 when a chest levels Tallow from 1", async () => {
  isolate(h);
  holdPassives(h, HELD);
  h.debug.setHp(BEFORE);
  assertEqual(
    h.snapshot().run.weapons.length,
    0,
    "weapons held, so no weapon can evolve or level instead",
  );

  const after = await openChest(h);
  captureStill(h, "chest");

  assertEqual(after.screen, "chest", "the screen the chest opened");
  assertDeepEqual(
    after.run.chestResult,
    { kind: "level", item: "tallow", level: 2 },
    "the chest's result with Tallow the only item below its max",
  );
  assertWithin(
    after.run.maxHp,
    AFTER,
    FIGURE_TOLERANCE,
    "maxHp after the chest's Tallow level",
  );
  assertWithin(
    after.run.player.hp,
    AFTER,
    FIGURE_TOLERANCE,
    "hp after the chest's Tallow level",
  );
});
