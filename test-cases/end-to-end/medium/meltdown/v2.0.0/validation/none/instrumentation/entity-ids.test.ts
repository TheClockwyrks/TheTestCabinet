// Meltdown — instrumentation/entity-ids: every entity carries a distinct id, is
// appended to its roster, and keeps that id.
//
// THE RULE. `specs/instrumentation.md`, under Identity: "Every tower and every
// surge unit carries an `id`: a number, distinct among the entities live at any
// moment, reported by `snapshot` and taken by every per-entity operation", and the
// two rules that make one findable: "An entity added through this surface is
// appended to its roster, so it is the last entry and its id is read from there",
// and "An id is never reused while the entity holding it is live, and an entity
// keeps its id for its whole life."
//
// WHY EVERY OTHER SUITE STANDS ON IT. `poseTower`, `poseWalker` and `poseTarget`
// each add one entity and read its id off the END of the roster, because the
// surface offers no other way to learn it. Every per-entity operation in this
// project — a heat, a gate, a position, a removal — is then addressed by that id.
// A build that prepends instead of appends hands every one of those scenarios the
// WRONG ENTITY while looking exactly like it worked: the heat lands on the
// bystander, and the check reads a tower nothing was done to.
//
// APPENDING IS ASSERTED AGAINST THE ROSTER BEFORE AND AFTER, never against what a
// helper handed back. `poseTower` reads the last entry, so asking it for an id and
// then checking that the id is last would be a tautology. Here the whole roster is
// read either side of each `addTower` and `addUnit`, and the new roster must be
// the old one, in order, with exactly one entry on the end.
//
// DISTINCTNESS IS READ ACROSS BOTH ROSTERS AT ONCE, because the specification's
// sentence covers "every tower and every surge unit" and says distinct "among the
// entities live at any moment".
//
// AND THE IDS ARE HELD ACROSS TWO THINGS THAT COULD DISTURB THEM: frames of the
// game running, and other entities being removed from under them. The units are
// posed with their locomotion off, because an id is not a faculty of walking and a
// unit that walked off the floor would leave the roster for a reason this point is
// not about.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertNotEqual,
} from "../assert";
import { type SurgeType, type TowerType } from "../constants";
import { freeSite } from "../fixtures";
import {
  captureStill,
  createHarness,
  framesFor,
  lastTower,
  lastUnit,
  startRun,
  type Harness,
} from "../harness";

/** The entities added, in the order they are added. */
const TOWERS: readonly TowerType[] = ["arc", "forge", "bloom", "sink"];
const UNITS: readonly SurgeType[] = ["mote", "drift", "hulk", "swarm"];

/** Seconds of game time the ids must survive. */
const HOLD_SECONDS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("appends each added entity to its roster with an id no live entity holds", async () => {
  await startRun(h);
  const live = new Set<number>();

  for (const [index, type] of TOWERS.entries()) {
    const before = (await h.snapshot()).towers.map((tower) => tower.id);
    const site = freeSite(index);
    await h.debug.addTower(type, site.col, site.row, 0);
    const after = (await h.snapshot()).towers;

    assertLength(
      after,
      before.length + 1,
      `the tower roster after adding a ${type}`,
    );
    assertDeepEqual(
      after.slice(0, -1).map((tower) => tower.id),
      before,
      `the tower roster before the ${type} was added, still in order and unchanged`,
    );
    const added = after[after.length - 1].id;
    assertEqual(
      added,
      lastTower(await h.snapshot())?.id,
      `the ${type} is the last entry of the tower roster`,
    );
    for (const held of live) {
      assertNotEqual(added, held, `the ${type}'s id against a live entity's`);
    }
    live.add(added);
  }

  for (const [index, type] of UNITS.entries()) {
    const before = (await h.snapshot()).surge.map((unit) => unit.id);
    await h.debug.addUnit(type, index % 2 === 0 ? "left" : "top");
    const after = (await h.snapshot()).surge;

    assertLength(
      after,
      before.length + 1,
      `the surge roster after adding a ${type}`,
    );
    assertDeepEqual(
      after.slice(0, -1).map((unit) => unit.id),
      before,
      `the surge roster before the ${type} was added, still in order and unchanged`,
    );
    const added = after[after.length - 1].id;
    assertEqual(
      added,
      lastUnit(await h.snapshot())?.id,
      `the ${type} is the last entry of the surge roster`,
    );
    for (const held of live) {
      assertNotEqual(added, held, `the ${type}'s id against a live entity's`);
    }
    live.add(added);
  }

  await h.advance(1);
  await captureStill(h, "roster");
  assertEqual(
    live.size,
    TOWERS.length + UNITS.length,
    "distinct ids across the two rosters",
  );
});

it("keeps every id across frames and across other entities being removed", async () => {
  await startRun(h);
  const towers: number[] = [];
  for (const [index, type] of TOWERS.entries()) {
    const site = freeSite(index);
    await h.debug.addTower(type, site.col, site.row, 0);
    towers.push((await h.snapshot()).towers.slice(-1)[0].id);
  }
  const units: number[] = [];
  for (const [index, type] of UNITS.entries()) {
    await h.debug.addUnit(type, index % 2 === 0 ? "left" : "top");
    const id = (await h.snapshot()).surge.slice(-1)[0].id;
    // An id is not a faculty of walking: held still, so a unit cannot leave the
    // roster by reaching its exhaust while the ids are being watched.
    await h.debug.setUnitMotion(id, false);
    units.push(id);
  }

  // Across frames of the game running.
  await h.advance(framesFor(HOLD_SECONDS));
  const driven = await h.snapshot();
  assertDeepEqual(
    driven.towers.map((tower) => tower.id),
    towers,
    `the tower ids after ${HOLD_SECONDS} second of game time`,
  );
  assertDeepEqual(
    driven.surge.map((unit) => unit.id),
    units,
    `the surge ids after ${HOLD_SECONDS} second of game time`,
  );

  // And across other entities being taken off the floor.
  await h.debug.removeTower(towers[1]);
  await h.debug.removeUnit(units[1]);
  await h.advance(framesFor(HOLD_SECONDS));

  const thinned = await h.snapshot();
  assertDeepEqual(
    thinned.towers.map((tower) => tower.id),
    towers.filter((id) => id !== towers[1]),
    "the surviving tower ids after another tower was removed",
  );
  assertDeepEqual(
    thinned.surge.map((unit) => unit.id),
    units.filter((id) => id !== units[1]),
    "the surviving surge ids after another unit was removed",
  );
});
