// Wick — enemies/mothwing-row: a mothwing spawns with the row `ENEMIES` holds for
// it: its health, the length of one step, the health a contact hit removes,
// and the radius its circle overlaps the lamplighter's within.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("The roster"): Mothwing's row reads HP `600`, speed
//     `90`, damage `20`, radius `28`, rank `elite`, behavior
//     `chase`.
//   - `specs/enemies.md` ("Health scaling"): "Elites and the Dark spawn with
//     their table HP as `maxHp`, unscaled". The spawn is posed at time 300,
//     where `hpMul` is 1.75, so a build that scaled a mothwing would read
//     1050 rather than the row's 600.
//   - `specs/enemies.md` ("Movement"): "one tick's step is `speed * TICK_DT`
//     units", 90 / 60 units here, and one tick moves it that far.
//   - `specs/world.md` ("Contact damage"): an overlapping enemy whose cooldown
//     is due removes `max(MIN_DAMAGE_TAKEN, enemy damage - armor)`, 20 with
//     no Brass held, and "the enemy's circle overlaps the lamplighter's when
//     the distance between their centers is less than the enemy's radius plus
//     `PLAYER_RADIUS`", 40 here.
//
// WHAT IS READ, HOW THE NIGHT IS POSED, AND THE TOLERANCES. `enemies/roster`,
// which reads exactly these four figures of one row and no other: the spawn's
// `hp` and `maxHp`, the distance one tick of `enemyMotion` carried it, the hp
// one tick of `enemyContact` removed from the lamplighter with the mothwing
// posed half a unit inside 40, and the hp it left alone with the mothwing
// posed half a unit outside 40.

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

it("spawns a mothwing with the health, speed, damage, and radius of its row", async () => {
  await assertRowOf(h, "mothwing", "row");
});
