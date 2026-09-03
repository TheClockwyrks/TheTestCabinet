// Wick — evolutions/pyre-heals-per-hit: each enemy a Pyre slash hits heals the
// lamplighter `PYRE_HEAL`.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/evolutions.md` ("Pyre"): "Each enemy a Pyre slash hits heals the
//     player `PYRE_HEAL` (`1`) health on the tick of the hit, capped at
//     `maxHp`." The fixed row has width `200`, height `60`, and damage `60`.
//   - `specs/evolutions.md` ("Pyre"): the facing-side rectangle extends
//     `width` from the player's `x` and is "centered vertically on the player's
//     `y`", so three moths on the lamplighter's `y` at 40, 80, and 120 along
//     `+x` all stand inside one slash; the mirrored rectangle covers `−200` to
//     `0`, where nothing stands.
//   - `specs/weapons.md` ("Shapes and overlap"): "A rectangle and a circle
//     overlap when the distance from the circle's center to the nearest point
//     of the rectangle is less than the circle's radius."
//   - `specs/world.md` ("Health and recovery"): a heal "adds to `hp` and caps
//     it at the `maxHp` in force"; `maxHp` is `BASE_MAX_HP` (`100`) with no
//     Tallow held, and `recovery` is `BASE_RECOVERY` (`0`) with no Tinder, so
//     the only thing that can move `hp` on the tick is the healing.
//   - `specs/instrumentation.md` (`setHp`): "Sets `hp` to `hp`, a real number
//     at most `maxHp`".
//
// WHAT IS READ. After the one firing tick, with `hp` posed to 50 and three
// moths inside the facing-side slash: `hp` reads 53, `PYRE_HEAL` for each of
// the three hits. A build that heals once per firing reads 51, and one that
// heals not at all reads 50.
//
// WHY THE NIGHT IS POSED AS IT IS. Pyre alone facing right, no passive held so
// the heal is the fixed figure and the rectangle the fixed length; three moths
// and nothing else on the field, so the hits counted are exactly three; every
// driver switch but `weaponFire` off, so no contact, no recovery, and no
// pickup can move `hp`; and `hp` posed 50 below `maxHp`, so the whole of the
// healing fits under the cap. The moths die on the tick, and their gems and any
// bread land at their own positions, 40 units out or further, beyond the
// collection distance of `PICKUP_ITEM_RADIUS` (`16`) plus `PLAYER_RADIUS`
// (`12`), so nothing else heals on the tick.
//
// TOLERANCE. `FIGURE_TOLERANCE` on `hp`: an exact sum of stated figures read
// back as a double.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import {
  BASE_MAX_HP,
  FIGURE_TOLERANCE,
  PYRE_HEAL,
  PYRE_STATS,
} from "../constants";
import {
  captureStill,
  createHarness,
  spawnEnemyNear,
  type Harness,
} from "../harness";
import { armEvolved } from "./evolved";

/** The enemy each probe is: HP 5, radius 10, killed outright by 60. */
const PROBE = "moth";

/** Where the three probes stand along +x, all inside a width of 200. */
const PROBE_OFFSETS = [40, 80, 120];

/** The health the run is posed at, clear of `maxHp` by more than the healing. */
const POSED_HP = 50;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("raises hp from 50 to 53 on the tick a slash hits three moths", async () => {
  assertEqual(
    PROBE_OFFSETS.every((offset) => offset < PYRE_STATS.width),
    true,
    "the probes' offsets against the slash's width",
  );
  assertEqual(
    POSED_HP + PROBE_OFFSETS.length * PYRE_HEAL <= BASE_MAX_HP,
    true,
    "the healed health against maxHp, so the cap does not decide the reading",
  );
  armEvolved(h, "pyre", { facing: "right" });
  for (const offset of PROBE_OFFSETS) spawnEnemyNear(h, PROBE, offset, 0);
  h.debug.setHp(POSED_HP);
  const posed = h.snapshot();
  assertEqual(posed.run.enemies.length, PROBE_OFFSETS.length, "moths posed");

  const after = await h.tick(1);
  captureStill(h, "healed");

  assertEqual(after.run.enemies.length, 0, "moths left after the firing tick");
  assertWithin(
    after.run.player.hp,
    POSED_HP + PROBE_OFFSETS.length * PYRE_HEAL,
    FIGURE_TOLERANCE,
    "hp after the firing tick, one PYRE_HEAL for each of the three hits",
  );
});
