// Wick — enemies/rat-row: a rat spawns with the row `ENEMIES` holds for
// it: its health, the length of one step, the health a contact hit removes,
// and the radius its circle overlaps the lamplighter's within.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("The roster"): Rat's row reads HP `15`, speed
//     `120`, damage `8`, radius `12`, rank `common`, behavior
//     `chase`.
//   - `specs/enemies.md` ("Health scaling"): a common enemy "spawns with
//     `maxHp = hp * hpMul(time)` and `hp = maxHp`", and `hpMul` is `1` at
//     time 0, so both readings are the row's 15.
//   - `specs/enemies.md` ("Movement"): "one tick's step is `speed * TICK_DT`
//     units", 120 / 60 units here, and one tick moves it that far.
//   - `specs/world.md` ("Contact damage"): an overlapping enemy whose cooldown
//     is due removes `max(MIN_DAMAGE_TAKEN, enemy damage - armor)`, 8 with
//     no Brass held, and "the enemy's circle overlaps the lamplighter's when
//     the distance between their centers is less than the enemy's radius plus
//     `PLAYER_RADIUS`", 24 here.
//
// WHAT IS READ, HOW THE NIGHT IS POSED, AND THE TOLERANCES. `enemies/roster`,
// which reads exactly these four figures of one row and no other: the spawn's
// `hp` and `maxHp`, the distance one tick of `enemyMotion` carried it, the hp
// one tick of `enemyContact` removed from the lamplighter with the rat
// posed half a unit inside 24, and the hp it left alone with the rat
// posed half a unit outside 24.

import { afterEach, beforeEach, it } from "vitest";
import { createHarness, type Harness } from "../harness";
import { assertRowOf } from "./roster";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("spawns a rat with the health, speed, damage, and radius of its row", async () => {
  await assertRowOf(h, "rat", "row");
});
