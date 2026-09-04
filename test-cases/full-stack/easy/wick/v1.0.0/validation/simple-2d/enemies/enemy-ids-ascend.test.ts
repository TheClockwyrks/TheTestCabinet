// Wick — enemies/enemy-ids-ascend: enemy ids rise in spawn order, and an id a
// removal frees is never handed out again.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("The life of an enemy"): "An enemy spawns with the
//     next id from `nextId`, so ids ascend in spawn order and each is used once
//     per run".
//   - `specs/instrumentation.md` ("The operations"): "A pose that creates an
//     entity gives it the next id from `nextId`", so a posed spawn takes an id
//     the same way a director spawn does.
//   - `specs/instrumentation.md` (`removeEnemy`): "Removes enemy `id`. Nothing
//     drops, nothing counts as a kill, and no cue plays", which frees no id.
//
// WHAT IS READ. The ids of four moths, each read as the entry `enemies` gained
// on the pose that spawned it rather than from `nextId`, so the reading rests on
// what the game handed the enemy and not on the counter it read from. The first
// three ascend, strictly. Then the first is removed and a fourth is spawned, and
// its id is above all three: a build that reuses a freed id, or that hands out
// the lowest free one, answers with an id at or below the first three and fails.
//
// WHY THE NIGHT IS POSED AS IT IS. Four moths at four bearings and nothing else,
// every switch off: nothing spawns, so no director spawn takes an id between two
// poses, and nothing moves or dies, so no removal but the posed one happens.
//
// TOLERANCE. None: ids are whole numbers compared exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, fail } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

/** The type spawned four times over; any type takes its id the same way. */
const TYPE = "moth";

/** Where the four moths stand, as offsets from the lamplighter's center. */
const PLACES: readonly (readonly [number, number])[] = [
  [150, 0],
  [0, 150],
  [-150, 0],
  [0, -150],
];

/** Spawn one moth at `(dx, dy)` and hand back the id `enemies` gained. */
function spawnAndReadId(h: Harness, dx: number, dy: number): number {
  const before = h.snapshot();
  const held = new Set(before.run.enemies.map((enemy) => enemy.id));
  const { player } = before.run;
  h.debug.spawnEnemy(TYPE, player.x + dx, player.y + dy);
  const added = h
    .snapshot()
    .run.enemies.filter((enemy) => !held.has(enemy.id))
    .map((enemy) => enemy.id);
  if (added.length !== 1) {
    fail("exactly one enemy added by the spawn", added.length);
  }
  return added[0];
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("hands the four moths ascending ids and reuses none the removal freed", async () => {
  isolate(h);
  const [first, second, third] = PLACES.slice(0, 3).map(([dx, dy]) =>
    spawnAndReadId(h, dx, dy),
  );

  assertGreaterThan(second, first, "the second moth's id against the first's");
  assertGreaterThan(third, second, "the third moth's id against the second's");

  h.debug.removeEnemy(first);
  const [dx, dy] = PLACES[3];
  const fourth = spawnAndReadId(h, dx, dy);
  // One inert tick, so the frame kept as evidence holds the moths that stand;
  // every switch is off, and nothing in the night moves or spawns.
  await h.tick(1);
  captureStill(h, "ids");

  assertGreaterThan(
    fourth,
    third,
    "the fourth moth's id against the highest already handed out",
  );
});
