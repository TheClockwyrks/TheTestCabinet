// Meltdown — instrumentation/remove-tower: `removeTower` removes exactly one
// tower.
//
// `specs/instrumentation.md`: "`removeTower(id)` — Removes that tower. Its
// footprint reopens and the routes are recomputed. It pays no refund and changes
// neither money nor score."
//
// EXACTLY ONE is the requirement, and it is why the floor carries three. A build
// whose `removeTower` cleared the roster passes any reading taken with one tower
// on the floor, so the two neighbours are read back by id afterwards — the same
// ids, on the same footprints, at the same levels — and the tile map is read for
// the tiles they still hold. Their footprint sizes differ, so a build that
// removed the wrong entry of the roster reports a different set of blocked tiles
// rather than a plausible one.
//
// THE REOPENED FOOTPRINT IS READ TILE BY TILE, against the exact block
// `specs/floor.md` gives a footprint: "it covers the tiles `col` through
// `col + size - 1`". Every one of those tiles must be open, and every tile of the
// two survivors must still be blocked.
//
// NO REFUND IS THE OTHER HALF, and it belongs here rather than in a point of its
// own because `removeTower` is the one-tower form of the clear: the tower removed
// is upgraded and fresh, so `specs/building.md`'s refund of the whole `spent`
// would be the largest a sale could pay, and the money and the score are both
// read.
//
// THE FRAME AFTER THE CALL is what the routes are read on, because
// `specs/mazing.md` recomputes them "on the frame the set of blocked tiles
// changes" — so the reading is taken after that frame has run and cannot depend
// on whether a build recomputes at the call or in the update that follows it.

import { afterEach, beforeEach, it } from "vitest";
import { MAX_LEVEL } from "../../src/constants";
import {
  assertContains,
  assertEqual,
  assertGreaterThan,
  assertLength,
} from "../assert";
import {
  blockedTiles,
  captureStill,
  createHarness,
  footprintTiles,
  sizeOf,
  startRun,
  type Harness,
  type TowerType,
} from "../harness";
import { quietSite, readTower } from "./ground";

/** The three towers on the floor, one per footprint size, in roster order. */
const TYPES: readonly TowerType[] = ["arc", "bloom", "lance"];

/** Which of them is removed: the middle entry, so an off-by-one is visible. */
const REMOVED = 1;

/** The money the floor is posed with, so the upgrades below are affordable. */
const PURSE = 100_000;

/** The score posed before the removal: a figure no scoring event lands on. */
const POSED_SCORE = 987_654;

/** Whether `tiles` holds the tile `(col, row)`. */
function holds(
  tiles: readonly { col: number; row: number }[],
  col: number,
  row: number,
): boolean {
  return tiles.some((tile) => tile.col === col && tile.row === row);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes that tower alone, reopens its footprint and pays nothing", async () => {
  startRun(h);
  h.debug.setMoney(PURSE);
  h.debug.setScore(POSED_SCORE);

  const ids = TYPES.map((type, index) => {
    const site = quietSite(index);
    h.debug.addTower(type, site.col, site.row, 0);
    const towers = h.snapshot().towers;
    const id = towers[towers.length - 1].id;
    // Upgraded and fresh, so a mistaken refund would be the largest one there is.
    for (let level = 1; level < MAX_LEVEL; level += 1) h.debug.upgradeTower(id);
    return id;
  });

  await h.advance(1);
  const before = h.snapshot();
  assertLength(before.towers, TYPES.length, "precondition: the towers posed");
  const doomed = readTower(before, ids[REMOVED], "the tower to be removed");
  assertEqual(
    doomed.fresh,
    true,
    "precondition: the tower removed still refunds in full",
  );
  assertGreaterThan(
    doomed.refund,
    0,
    "precondition: a mistaken refund would be a figure worth reading",
  );
  const moneyBefore = before.money;
  const survivors = ids.filter((_, index) => index !== REMOVED);
  const survivorState = survivors.map((id) =>
    readTower(before, id, "a tower the removal must leave standing"),
  );

  h.debug.removeTower(ids[REMOVED]);
  await h.advance(1);
  captureStill(h, "removed");
  const after = h.snapshot();

  // One gone.
  assertLength(
    after.towers,
    TYPES.length - 1,
    "the tower roster after removeTower",
  );
  assertEqual(
    after.towers.some((tower) => tower.id === ids[REMOVED]),
    false,
    "the removed tower is off the roster",
  );

  // Its footprint reopened, tile by tile.
  const blocked = blockedTiles(after);
  for (const tile of footprintTiles(
    doomed.col,
    doomed.row,
    sizeOf(TYPES[REMOVED]),
  )) {
    assertEqual(
      holds(blocked, tile.col, tile.row),
      false,
      `tile (${tile.col}, ${tile.row}) of the removed footprint is open again`,
    );
  }

  // And the others exactly as they were, tiles included.
  for (const [index, id] of survivors.entries()) {
    const standing = readTower(after, id, "a tower the removal left standing");
    const was = survivorState[index];
    assertEqual(standing.col, was.col, `tower ${id}: its column`);
    assertEqual(standing.row, was.row, `tower ${id}: its row`);
    assertEqual(standing.level, was.level, `tower ${id}: its level`);
    assertEqual(standing.spent, was.spent, `tower ${id}: what was spent on it`);
    for (const tile of footprintTiles(
      standing.col,
      standing.row,
      standing.size,
    )) {
      assertEqual(
        holds(blocked, tile.col, tile.row),
        true,
        `tile (${tile.col}, ${tile.row}) of tower ${id} is still blocked`,
      );
    }
    assertContains(
      after.towers.map((tower) => tower.id),
      id,
      "the roster still holds the towers the removal did not name",
    );
  }

  // And nothing was paid for it.
  assertEqual(after.money, moneyBefore, "the money after removeTower");
  assertEqual(after.score, POSED_SCORE, "the score after removeTower");
});
