// Meltdown — instrumentation/entity-ids: every entity carries a distinct, stable
// id.
//
// `specs/instrumentation.md`, Identity: "Every tower and every surge unit carries
// an `id`: a number, distinct among the entities live at any moment, reported by
// `snapshot` and taken by every per-entity operation." And the two rules that
// make an id findable without an assignment scheme: "An entity added through this
// surface is appended to its roster, so it is the last entry and its id is read
// from there. A tower committed by `place` is appended the same way", and "An id
// is never reused while the entity holding it is live, and an entity keeps its id
// for its whole life."
//
// DISTINCT AMONG THE ENTITIES LIVE AT ANY MOMENT is read across BOTH rosters,
// because that is what the sentence says: a tower's id and a unit's id are ids of
// entities, and every per-entity operation takes one. A build that counted towers
// and units on two independent counters would hand `setTowerHeat` and
// `setUnitHp` the same number, and every scenario in this suite that poses a
// floor with both on it would be reaching for whichever the build happened to
// look up first.
//
// APPENDED, so the id is READABLE. Every helper in this suite reads an added
// entity's id off the last entry of its roster, which is only sound because the
// specification says that is where it lands. So each addition below is checked
// where it landed, not merely for having landed.
//
// KEPT FOR ITS WHOLE LIFE, read two ways: across frames of the game running, and
// across other entities being removed. The second is the one that catches an id
// derived from a roster INDEX — the commonest way an id stops being an identity —
// because removing an early entry renumbers everything after it, and the tower
// and unit removed below are both early ones.
//
// THE ENTITIES ARE POSED STILL AND THE FLOOR IS QUIET, so nothing leaves the
// roster for a reason this point did not arrange: no shot can kill a unit, no
// release can add one, and no walker can reach an exhaust.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertEqual,
  assertLength,
  assertNotEqual,
} from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  ticksFor,
  tileCenter,
  type Harness,
  type TowerType,
} from "../harness";
import { quietSite, readTower, readUnit } from "./ground";

/** The towers added, in the order they are added. */
const TOWER_TYPES: readonly TowerType[] = ["arc", "bloom", "lance", "forge"];

/** How many units are added beside them. */
const UNITS = 4;

/** Which entries are removed, to renumber whatever follows them. */
const REMOVED_TOWER = 0;
const REMOVED_UNIT = 1;

/** Frames of the game running between one reading of the ids and the next. */
const RUN_FRAMES = ticksFor(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives every entity a distinct id, appends it, and keeps it across frames and removals", async () => {
  startRun(h);

  // Every addition is read where the specification says it lands: last.
  const towerIds = TOWER_TYPES.map((type, index) => {
    const site = quietSite(index);
    h.debug.addTower(type, site.col, site.row, 0);
    const towers = h.snapshot().towers;
    assertLength(towers, index + 1, `the roster after adding the ${type}`);
    const added = towers[towers.length - 1];
    assertEqual(
      added.type,
      type,
      `the last roster entry after adding the ${type}`,
    );
    return added.id;
  });

  const unitIds: number[] = [];
  for (let index = 0; index < UNITS; index += 1) {
    h.debug.addUnit("mote", "left");
    const surge = h.snapshot().surge;
    assertLength(
      surge,
      index + 1,
      `the surge roster after adding unit ${index}`,
    );
    const added = surge[surge.length - 1];
    const site = quietSite(index + 8);
    const at = tileCenter(site.col, site.row);
    h.debug.setUnitPosition(added.id, at.x, at.y);
    h.debug.setUnitMotion(added.id, false);
    unitIds.push(added.id);
  }

  // Distinct among every entity live at this moment, towers and units together.
  const all = [...towerIds, ...unitIds];
  assertEqual(
    new Set(all).size,
    all.length,
    "the distinct ids among every live entity, against how many there are",
  );
  for (const towerId of towerIds) {
    for (const unitId of unitIds) {
      assertNotEqual(towerId, unitId, "a tower's id against a live unit's");
    }
  }

  // Kept across frames of the game running.
  await h.advance(RUN_FRAMES);
  captureStill(h, "roster");
  const running = h.snapshot();
  for (const [index, id] of towerIds.entries()) {
    assertEqual(
      readTower(running, id, "a tower after a second of game time").type,
      TOWER_TYPES[index],
      `tower ${id} is the same tower a second later`,
    );
  }
  for (const id of unitIds) {
    assertContains(
      running.surge.map((unit) => unit.id),
      id,
      "a unit's id after a second of game time",
    );
  }

  // And kept across other entities being removed — an early one of each, so a
  // build whose id is a roster index renumbers everything behind it.
  h.debug.removeTower(towerIds[REMOVED_TOWER]);
  h.debug.removeUnit(unitIds[REMOVED_UNIT]);
  await h.advance(1);
  const thinned = h.snapshot();

  for (const [index, id] of towerIds.entries()) {
    if (index === REMOVED_TOWER) {
      assertEqual(
        thinned.towers.some((tower) => tower.id === id),
        false,
        "the removed tower is off the roster",
      );
      continue;
    }
    assertEqual(
      readTower(thinned, id, "a tower after another was removed").type,
      TOWER_TYPES[index],
      `tower ${id} kept its id across another tower's removal`,
    );
  }
  for (const [index, id] of unitIds.entries()) {
    if (index === REMOVED_UNIT) {
      assertEqual(
        thinned.surge.some((unit) => unit.id === id),
        false,
        "the removed unit is off the roster",
      );
      continue;
    }
    assertEqual(
      readUnit(thinned, id, "a unit after another was removed").type,
      "mote",
      `unit ${id} kept its id across another unit's removal`,
    );
  }

  // A tower added after the removals takes an id no live entity holds, so an id
  // is not reused while its holder is live.
  const fresh = quietSite(TOWER_TYPES.length);
  h.debug.addTower("stutter", fresh.col, fresh.row, 0);
  const afterwards = h.snapshot();
  const added = afterwards.towers[afterwards.towers.length - 1];
  const live = [
    ...afterwards.towers.filter((tower) => tower.id !== added.id),
    ...afterwards.surge,
  ].map((entity) => entity.id);
  assertEqual(
    live.includes(added.id),
    false,
    "the id a new tower took, against every other live entity's",
  );
});
