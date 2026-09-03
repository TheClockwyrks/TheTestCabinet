// Wick — passives/tallow-gain-via-chest: a Tallow level a chest grants raises
// `hp` by `15` as an accepted offer does.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("Max health"): "Each
// time Tallow rises by one level, whether it is gained at level `1` or leveled
// from any level below its max, and through whichever path grants it, the
// lamplighter's current `hp` rises by `TALLOW_HP_PER_LEVEL` on the same tick
// that `maxHp` does", with `TALLOW_HP_PER_LEVEL` (`15`).
// `specs/evolutions.md` ("Opening a chest") gives the chest's second rule: "One
// held item below its max level, a base weapon below `MAX_WEAPON_LEVEL` or a
// passive below its own max, is chosen uniformly at random from the game's
// seeded generator and rises by `1`, exactly as accepting a `+1 level` offer
// does. The result is `{ kind: "level", item, level }`". So with Tallow at
// level 1 the only item held, a chest levels it to `2`: `maxHp` rises from
// `115` to `130` and `hp` from the posed `115` to `130`.
//
// THE POSE. An isolated night, whose starting Taper is removed, so the only
// held item is the Tallow placed at level 1 through `setPassive` and the
// chest's draw has exactly one candidate. `hp` is posed to `115` through
// `setHp`, which the raised maximum allows, so the gain is read against a
// health that is already full. The chest is opened the way a chest is opened:
// `spawnPickup("chest", ...)` at the lamplighter's center and the tick that
// collects it. No weapon is held, so rule 1 of the chest passes over the
// loadout and rule 3 never applies. Every faculty stays held.
//
// TOLERANCE. `FLOAT_TOL` on `hp` and `maxHp`, whole numbers the formulas give
// exactly. A build that raised `maxHp` alone leaves `hp` at `115`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNear } from "../assert";
import { FLOAT_TOL, maxHpOf } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  openChest,
  player,
  type Harness,
} from "../harness";

/** The Tallow level held before the chest: `maxHp` `115`. */
const HELD = 1;

/** The level the chest's draw takes it to. */
const GAINED = HELD + 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads hp 130 and maxHp 130 when a chest levels the only held item, Tallow 1", async () => {
  const opened = await isolate(h);
  assertEqual(
    opened.run.weapons?.length,
    0,
    "the weapons held before the chest",
  );
  await holdPassive(h, "tallow", HELD);
  await h.debug.setHp(maxHpOf({ tallow: HELD }));

  const collected = await openChest(h);
  await captureStill(h, "chest");

  assertEqual(
    collected.screen,
    "chest",
    "the screen the collected chest opened",
  );
  assertDeepEqual(
    collected.run.chestResult,
    { kind: "level", item: "tallow", level: GAINED },
    "the chest's result with Tallow 1 the only item below its max",
  );
  assertNear(
    collected.run.maxHp,
    maxHpOf({ tallow: GAINED }),
    FLOAT_TOL,
    "maxHp after the chest's Tallow level",
  );
  assertNear(
    player(collected).hp,
    maxHpOf({ tallow: GAINED }),
    FLOAT_TOL,
    "hp after the chest's Tallow level, raised by 15 from 115",
  );
});
