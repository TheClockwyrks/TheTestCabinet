// Wick — enemies/hound-row: a hound spawns with the row `ENEMIES` holds for
// it: its health, the length of one step, the health a contact hit removes,
// and the radius its circle overlaps the lamplighter's within.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("The roster"): Hound's row reads HP `120`, speed
//     `110`, damage `20`, radius `18`, rank `common`, behavior
//     `chase`.
//   - `specs/enemies.md` ("Health scaling"): a common enemy "spawns with
//     `maxHp = hp * hpMul(time)` and `hp = maxHp`", and `hpMul` is `1` at
//     time 0, so both readings are the row's 120.
//   - `specs/enemies.md` ("Movement"): "one tick's step is `speed * TICK_DT`
//     units", 110 / 60 units here, and one tick moves it that far.
//   - `specs/world.md` ("Contact damage"): an overlapping enemy whose cooldown
//     is due removes `max(MIN_DAMAGE_TAKEN, enemy damage - armor)`, 20 with
//     no Brass held, and "the enemy's circle overlaps the lamplighter's when
//     the distance between their centers is less than the enemy's radius plus
//     `PLAYER_RADIUS`", 30 here.
//
// WHAT IS READ, HOW THE NIGHT IS POSED, AND THE TOLERANCES. `enemies/roster`,
// which reads exactly these four figures of one row and no other: the spawn's
// `hp` and `maxHp`, the distance one tick of `enemyMotion` carried it, the hp
// one tick of `enemyContact` removed from the lamplighter with the hound
// posed half a unit inside 30, and the hp it left alone with the hound
// posed half a unit outside 30.

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

it("spawns a hound with the health, speed, damage, and radius of its row", async () => {
  await assertRowOf(h, "hound", "row");
});
