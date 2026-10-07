// passives/tallow-max-hp — Tallow raises the maximum health by
// TALLOW_HP_PER_LEVEL a level, and a heal fills to that new maximum.
//
// WHERE THE THRESHOLD COMES FROM. specs/passives.md ("The derived stats"):
// "maxHp = BASE_MAX_HP + TALLOW_HP_PER_LEVEL × tallow", with BASE_MAX_HP 100
// and TALLOW_HP_PER_LEVEL 15, so Tallow 3 gives 100 + 45 = 145; and ("Max
// health") "Every heal and every recovery tick caps `hp` at the `maxHp` in
// force when it is applied". specs/world.md ("Pickups") has bread heal
// BREAD_HEAL (30) "capped at `maxHp`", so from hp 120 a bread carries hp to
// min(145, 150) = 145 rather than stopping at the base 100.
//
// THE WORLD. An isolated playing run: nothing on the field, no weapon held,
// Tallow alone at level 3 in the first passive slot, every driver switch off,
// and hp posed to 120, which `setHp` allows because it is at most the raised
// maxHp. One bread lies at the lamplighter's center, inside the
// PICKUP_ITEM_RADIUS (16) plus PLAYER_RADIUS (12) that specs/world.md collects
// at, so the single tick that follows collects it. No Tinder is held, so
// recovery is BASE_RECOVERY (0) and the only change to hp is the heal.
//
// WHAT IS READ. `maxHp` off the snapshot after the pose, 145, with `hp` still
// the 100 a run starts at ("`hp` is untouched", specs/instrumentation.md,
// `setPassive`); then `hp` after the collecting tick, 145. The second reading
// is what tells a build that reports the raised maximum from one that honors
// it: a build capping at 100 stops there.
//
// TOLERANCE. FIGURE_TOLERANCE (1e-9) on each, a sum of stated figures read back
// as a double.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertWithin } from "../assert";
import {
  BREAD_HEAL,
  FIGURE_TOLERANCE,
  derived,
  type HeldPassives,
} from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  spawnPickupAt,
  type Harness,
} from "../harness";
import { holdPassives } from "./night";

/** The passives held: Tallow at level 3. */
const HELD: HeldPassives = { tallow: 3 };

/** 100 + 15 × 3 = 145. */
const MAX_HP = derived.maxHp(HELD);

/** The health the bread heals from: 120, so 120 + 30 clears the new maximum. */
const POSED_HP = 120;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads maxHp 145 with Tallow 3 held and lets a bread carry hp to 145", async () => {
  const posed = isolate(h);
  holdPassives(h, HELD);
  const raised = h.snapshot();
  assertWithin(
    raised.run.maxHp,
    MAX_HP,
    FIGURE_TOLERANCE,
    "maxHp with Tallow 3 held",
  );
  assertWithin(
    raised.run.player.hp,
    posed.run.player.hp,
    FIGURE_TOLERANCE,
    "hp across the Tallow pose, which leaves it untouched",
  );

  h.debug.setHp(POSED_HP);
  const { player } = h.snapshot().run;
  spawnPickupAt(h, "bread", player.x, player.y);

  const after = await h.tick(1);
  captureStill(h, "max");

  assertLength(after.run.pickups, 0, "pickups left after the collecting tick");
  assertWithin(
    after.run.player.hp,
    Math.min(MAX_HP, POSED_HP + BREAD_HEAL),
    FIGURE_TOLERANCE,
    "hp after a bread healed against the raised maximum",
  );
});
