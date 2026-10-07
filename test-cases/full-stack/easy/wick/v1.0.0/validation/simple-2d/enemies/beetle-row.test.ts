// Wick — enemies/beetle-row: a beetle spawns with the row `ENEMIES` holds for
// it: its health, the length of one step, the health a contact hit removes,
// and the radius its circle overlaps the lamplighter's within.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("The roster"): Beetle's row reads HP `25`, speed
//     `60`, damage `10`, radius `14`, rank `common`, behavior
//     `chase`.
//   - `specs/enemies.md` ("Health scaling"): a common enemy "spawns with
//     `maxHp = hp * hpMul(time)` and `hp = maxHp`", and `hpMul` is `1` at
//     time 0, so both readings are the row's 25.
//   - `specs/enemies.md` ("Movement"): "one tick's step is `speed * TICK_DT`
//     units", 60 / 60 units here, and one tick moves it that far.
//   - `specs/world.md` ("Contact damage"): an overlapping enemy whose cooldown
//     is due removes `max(MIN_DAMAGE_TAKEN, enemy damage - armor)`, 10 with
//     no Brass held, and "the enemy's circle overlaps the lamplighter's when
//     the distance between their centers is less than the enemy's radius plus
//     `PLAYER_RADIUS`", 26 here.
//
// WHAT IS READ, HOW THE NIGHT IS POSED, AND THE TOLERANCES. `enemies/roster`,
// which reads exactly these four figures of one row and no other: the spawn's
// `hp` and `maxHp`, the distance one tick of `enemyMotion` carried it, the hp
// one tick of `enemyContact` removed from the lamplighter with the beetle
// posed half a unit inside 26, and the hp it left alone with the beetle
// posed half a unit outside 26.

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

it("spawns a beetle with the health, speed, damage, and radius of its row", async () => {
  await assertRowOf(h, "beetle", "row");
});
