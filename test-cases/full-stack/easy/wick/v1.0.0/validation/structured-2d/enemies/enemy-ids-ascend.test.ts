// enemies/enemy-ids-ascend — enemy ids ascend in spawn order.
//
// WHERE THE THRESHOLD COMES FROM. `specs/enemies.md` ("The life of an
// enemy"): "An enemy spawns with the next id from `nextId`, so ids ascend in
// spawn order and each is used once per run."
// `specs/instrumentation.md` says the same of a posed spawn: "A pose that
// creates an entity gives it the next id from `nextId`". So three enemies
// spawned in turn must read three strictly ascending ids. The threshold is the
// ordering itself, whole numbers compared exactly, with no figure to round.
// That an id a removal frees is never handed out again is
// `enemies/enemy-ids-never-reused`'s.
//
// WHY EACH ID IS READ OFF THE SNAPSHOT. The id a spawn WILL take can be
// predicted from `nextId`, and every other check in this project does predict
// it — but this one is about the ids themselves, so it takes each from the
// enemy the pose actually added, as the one entry of `enemies` that was not
// there a moment before. A build whose `nextId` and whose handed-out ids
// disagree fails here rather than passing on its own prediction.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with every driver switch
// off, so the only enemies that exist are the three posed here and no director
// spawn takes an id between them. Each stands at a post of its own, `POST`
// units out in a direction of its own, clear of the lamplighter and of each
// other, so nothing touches anything; three types are used so a reviewer's
// still shows three distinguishable silhouettes rather than one repeated.
//
// THE TOLERANCE. None: ids are whole numbers, and the comparisons are strict
// inequalities.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, fail } from "../assert";
import { type EnemyId } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

/** How far from the lamplighter each post stands. */
const POST = 300;

/**
 * Spawn one enemy of `type` at `(x, y)` and answer the id the game gave it,
 * read as the one entry of `enemies` that the pose added.
 */
function spawned(h: Harness, type: EnemyId, x: number, y: number): number {
  const had = new Set(h.snapshot().run.enemies.map((enemy) => enemy.id));
  h.debug.spawnEnemy(type, x, y);
  const fresh = h.snapshot().run.enemies.filter((enemy) => !had.has(enemy.id));
  if (fresh.length !== 1) {
    fail(
      `exactly one enemy with an id no other enemy holds after spawning one ${type} (specs/enemies.md, The life of an enemy)`,
      fresh.length,
    );
  }
  return fresh[0].id;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("gives three enemies ascending ids", async () => {
  isolate(h);
  const { player } = h.snapshot().run;
  const first = spawned(h, "moth", player.x + POST, player.y);
  const second = spawned(h, "bat", player.x - POST, player.y);
  const third = spawned(h, "rat", player.x, player.y + POST);
  captureStill(h, "ids");

  assertGreaterThan(
    second,
    first,
    "the id of the second enemy spawned, against the first's (specs/enemies.md, The life of an enemy)",
  );
  assertGreaterThan(
    third,
    second,
    "the id of the third enemy spawned, against the second's (specs/enemies.md, The life of an enemy)",
  );
});
