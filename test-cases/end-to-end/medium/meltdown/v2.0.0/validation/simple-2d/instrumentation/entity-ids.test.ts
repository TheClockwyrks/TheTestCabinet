// Meltdown — instrumentation/entity-ids: every entity carries a distinct, stable
// id.
//
// specs/instrumentation.md, Identity: "Every tower and every surge unit carries an
// `id`: a number, distinct among the entities live at any moment, reported by
// `snapshot` and taken by every per-entity operation." Two rules make one findable
// without an assignment scheme: "An entity added through this surface is appended
// to its roster, so it is the last entry and its id is read from there", and "An id
// is never reused while the entity holding it is live, and an entity keeps its id
// for its whole life."
//
// THIS IS THE RULE EVERY OTHER CHECK IN THE SUITE STANDS ON. `poseTower` and
// `poseWalker` read the id of what they just posed off the last entry of its
// roster, so a build that appends anywhere but the end, or hands two live entities
// the same number, silently redirects every per-entity operation in this project at
// the wrong entity. That is why the reading here is taken after EVERY SINGLE
// addition rather than once at the end: the roster has to be right at each step,
// not merely right when the posing stops.
//
// THE TWO ROSTERS ARE READ TOGETHER, because "distinct among the entities live at
// any moment" is stated of the entities and not of either roster: a tower and a
// unit live at the same moment carry different numbers. The additions are therefore
// interleaved, a tower then a unit and round again, so a build whose two rosters
// count separately is caught on the second pair rather than never.
//
// STABILITY IS READ ACROSS BOTH THINGS THAT CAN DISTURB IT: a stretch of frames, in
// which the game's own systems run over both rosters, and the REMOVAL of one entity
// from each, which is where a build that indexes by position rather than by
// identity renumbers everything after the hole.
//
// THE FLOOR IS BUILT OUT OF SHORT-RANGE EMITTERS AND MOVERS, and the units enter at
// the left vent eleven tiles away, so nothing fires under the reading and no unit
// dies while its id is being watched. Nothing here is about combat.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue, fail } from "../assert";
import {
  captureStill,
  createHarness,
  hasTower,
  hasUnit,
  lastTower,
  lastUnit,
  poseTower,
  poseWalker,
  startRun,
  ticksFor,
  type Harness,
  type MeltdownSnapshot,
  type SurgeType,
  type TowerType,
} from "../harness";

/** The towers posed, in order: short-range emitters and movers only. */
const TOWERS: ReadonlyArray<{ type: TowerType; col: number; row: number }> = [
  { type: "arc", col: 5, row: 5 },
  { type: "forge", col: 9, row: 5 },
  { type: "stutter", col: 13, row: 5 },
  { type: "sink", col: 5, row: 9 },
  { type: "rime", col: 9, row: 9 },
];

/** The units posed, in order, one after each tower. */
const UNITS: readonly SurgeType[] = [
  "mote",
  "sprint",
  "swarm",
  "hulk",
  "drift",
];

/** How long the ids are watched running: one second of game time. */
const WATCH_TICKS = ticksFor(1);

/** Every id live at this moment, towers and units together. */
function liveIds(s: MeltdownSnapshot): number[] {
  return [...s.towers.map((t) => t.id), ...s.surge.map((u) => u.id)];
}

/** Fail unless no two live entities carry the same id. */
function assertDistinct(s: MeltdownSnapshot, context: string): void {
  const ids = liveIds(s);
  if (new Set(ids).size !== ids.length) {
    fail(`one id per live entity (${context})`, ids);
  }
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("appends each entity to its roster with an id no other live entity carries", async () => {
  startRun(h);

  const towers: number[] = [];
  const units: number[] = [];
  for (let i = 0; i < TOWERS.length; i += 1) {
    const at = TOWERS[i];
    const tower = poseTower(h, at.type, at.col, at.row);
    towers.push(tower);
    assertEqual(
      lastTower(h.snapshot()).id,
      tower,
      `the ${at.type} added is the tower roster's last entry`,
    );
    assertDistinct(h.snapshot(), `after adding the ${at.type}`);

    const unit = poseWalker(h, UNITS[i], "left");
    units.push(unit);
    assertEqual(
      lastUnit(h.snapshot()).id,
      unit,
      `the ${UNITS[i]} added is the surge roster's last entry`,
    );
    assertDistinct(h.snapshot(), `after adding the ${UNITS[i]}`);
  }

  const posed = h.snapshot();
  assertLength(
    posed.towers,
    TOWERS.length,
    "every tower posed is on the floor",
  );
  assertLength(posed.surge, UNITS.length, "every unit posed is on the floor");

  // Stability across frames: the game's own systems run over both rosters and
  // every entity keeps the number it was given.
  await h.advance(WATCH_TICKS);
  const running = h.snapshot();
  captureStill(h, "roster");
  for (const id of towers) {
    assertTrue(hasTower(running, id), `tower ${id} keeps its id across frames`);
  }
  for (const id of units) {
    assertTrue(hasUnit(running, id), `unit ${id} keeps its id across frames`);
  }
  assertDistinct(running, "after a second of game time");

  // Stability across a removal: one entity of each kind is taken away, and every
  // other entity is still findable by the number it has carried all along.
  h.debug.removeTower(towers[1]);
  h.debug.removeUnit(units[2]);
  const thinned = h.snapshot();

  assertTrue(!hasTower(thinned, towers[1]), "the removed tower is gone");
  assertTrue(!hasUnit(thinned, units[2]), "the removed unit is gone");
  for (const [index, id] of towers.entries()) {
    if (index === 1) continue;
    assertTrue(
      hasTower(thinned, id),
      `tower ${id} keeps its id across another entity's removal`,
    );
  }
  for (const [index, id] of units.entries()) {
    if (index === 2) continue;
    assertTrue(
      hasUnit(thinned, id),
      `unit ${id} keeps its id across another entity's removal`,
    );
  }
  assertDistinct(thinned, "after a removal from each roster");
});
