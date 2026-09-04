// evolutions/evolves-when-eligible — a maxed base beside its recipe passive
// evolves on a chest.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("The recipe"): "A
// base weapon is eligible to evolve when all three hold at once: it is held at
// `MAX_WEAPON_LEVEL` (`8`); the passive its recipe names is held, at any
// level; the player opens a chest." The recipe table gives Pyre as Taper's
// evolution with Wick as its passive. ("Opening a chest"), rule 1: "the first
// base weapon at `MAX_WEAPON_LEVEL` whose recipe passive is held at any level
// evolves ... The evolved weapon replaces its base in the same slot with a
// single level ... The result is `{ kind: "evolve", weapon }`." So with Taper
// at 8 in slot 0 and Wick 1 held, the tick that collects a chest leaves
// `weapons[0]` reading `pyre` at level 1, no slot holding `taper`, and
// `chestResult` reading `{ kind: "evolve", weapon: "pyre" }`.
//
// HOW THE CHEST IS OPENED. `specs/instrumentation.md`: "The chest overlay is
// reached through `spawnPickup("chest", x, y)` at the lamplighter's center and
// one tick, which is the real collection path", and `specs/world.md`
// ("Collection") collects a pickup within `PICKUP_ITEM_RADIUS + PLAYER_RADIUS`
// of the lamplighter's center, which a chest at that center is. No pose
// decides the result: the tick applies it (`specs/progression.md`, The chest
// overlay).
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding nothing but Taper
// at 8 and Wick 1, every driver switch off, so the tick that collects the
// chest fires no weapon, spawns nothing, and moves nothing: what it changed is
// the chest's doing alone. The level is `ISOLATE_LEVEL`, far above any gain,
// so no level-up overlay competes for the tick.
//
// THE TOLERANCE. None: a slot's id and level, and a result object, are read
// exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertUndefined } from "../assert";
import { MAX_WEAPON_LEVEL } from "../constants";
import {
  captureStill,
  createHarness,
  heldWeapon,
  isolate,
  openChest,
  type Harness,
} from "../harness";
import { holdRecipe } from "./evolved";

/** The Wick level held; any level makes the recipe eligible. */
const WICK_LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves Pyre at level 1 in Taper's slot and reports an evolve result", async () => {
  isolate(h);
  const slot = holdRecipe(h, "pyre", MAX_WEAPON_LEVEL, WICK_LEVEL);

  const after = await openChest(h);
  captureStill(h, "evolved");

  assertEqual(
    after.screen,
    "chest",
    "the screen the tick that collected the chest ended on (specs/progression.md, The chest overlay)",
  );
  assertEqual(
    after.run.weapons[slot]?.id,
    "pyre",
    `the weapon in slot ${slot}, where Taper stood at level ${MAX_WEAPON_LEVEL} (specs/evolutions.md, Opening a chest)`,
  );
  assertEqual(
    after.run.weapons[slot]?.level,
    1,
    "Pyre's level, the single level an evolved weapon has (specs/evolutions.md, What an evolution is)",
  );
  assertUndefined(
    heldWeapon(after, "taper"),
    "the slot holding Taper after the evolution (specs/evolutions.md, What an evolution is)",
  );
  assertDeepEqual(
    after.run.chestResult,
    { kind: "evolve", weapon: "pyre" },
    "the chest's result (specs/evolutions.md, Opening a chest)",
  );
});
