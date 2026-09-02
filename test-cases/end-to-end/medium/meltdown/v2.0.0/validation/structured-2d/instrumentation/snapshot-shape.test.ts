// Meltdown — instrumentation/snapshot-shape: `snapshot` reports the whole
// documented shape.
//
// `specs/instrumentation.md`, Snapshot shape: "`snapshot` returns exactly this
// object. Every field an operation can set is present, so every operation is
// verifiable by setting a value and reading it back." This point holds a build to
// that object — every field of the run, of the panel's `controls`, of a tower and
// of a unit, at the type the specification writes beside it.
//
// IT IS READ OFF A FLOOR THAT EXERCISES EVERY BRANCH. A shape check taken on the
// title screen would read a great many `null`s and empty arrays and could not
// tell a complete snapshot from a stub, so the floor posed below carries one
// tower of each of the three footprint sizes `specs/towers.md` gives — a 2x2 Arc,
// a 3x3 Bloom, a 4x4 Lance — at the three levels and at three different heats,
// with the Lance tripped and its cooldown running; both movers, whose `heat`,
// `heatMult` and `damage` the specification fixes at `0` and whose
// `radiatorFaces` is empty; one unit of each of the six surge types, so a flyer
// and a ground unit are both reported; a held preview; a selection, which is what
// makes `controls.upgrade` and `controls.sell` rectangles rather than `null`; and
// a pressed pointer.
//
// THE FIELDS THE SPECIFICATION CALLS OUT ARE READ AS VALUES, NOT ONLY AS TYPES.
// `pointer` is the pointer's own position "never an entity's centre", so the
// press below is asserted at the point it was made; `simTime` "accumulates the
// game time the simulation advanced by", so it is asserted to have accumulated.
//
// WHAT THIS POINT DOES NOT DECIDE. Whether each figure is CORRECT — a Lance's
// redline, a Rime's slow, a route's length — belongs to the group that owns that
// rule. This one decides that the field is there, of the documented type, and in
// the documented range where the specification gives one.
//
// THE PRESS IS MADE LAST AND READ WITH NO FRAME BETWEEN. `pointer` mirrors what
// the pointer input reports and is refreshed in every update, so a frame advanced
// after a posed press would report the runtime's own idle pointer instead — which
// is why the still is captured before the press rather than after it.

import { afterEach, beforeEach, it } from "vitest";
import {
  DIFFICULTIES,
  MODES,
  SURGE_TYPES,
  TOWER_TYPES,
} from "../constants";
import {
  assertBetween,
  assertContains,
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertHasProperty,
  assertLength,
  assertNotNull,
  assertTrue,
} from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  tileCenter,
  type ControlRect,
  type Harness,
  type MeltdownSnapshot,
  type TowerSnapshot,
  type UnitSnapshot,
} from "../harness";
import { quietSite, readTower } from "./ground";

/** The eight screens `specs/instrumentation.md` names, as the snapshot reports one. */
const SCREENS = [
  "title",
  "modeselect",
  "difficultyselect",
  "howto",
  "playing",
  "paused",
  "victory",
  "gameover",
];

/** The three sub-phases of `playing`. */
const PHASES = ["opening", "building", "wave"];

/** The four world-oriented faces a radiator may point at. */
const FACES = ["N", "E", "S", "W"];

/** The two vents and their two fixed opposites (`specs/floor.md`). */
const VENTS = ["left", "top"];
const EXHAUSTS = ["right", "bottom"];

/** The heats the three emitters are posed at, one per footprint size. */
const ARC_HEAT = 20;
const BLOOM_HEAT = 55;
const LANCE_HEAT = 90;

/** The seconds left on the tripped Lance's cooldown when the floor is posed. */
const LANCE_TRIP_TIMER = 3.5;

/** Where the press is made: a point on the build panel, in logical stage units. */
const PRESS_X = 1100;
const PRESS_Y = 60;

/** The frames run before the reading, so `simTime` has something to report. */
const SETTLE_FRAMES = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Every field of a control rectangle is a number. */
function assertRect(rect: ControlRect | null, what: string): void {
  assertNotNull(rect, what);
  const box = rect as ControlRect;
  for (const field of ["x", "y", "w", "h"] as const) {
    assertEqual(typeof box[field], "number", `${what}: ${field}`);
  }
}

/** Every field `specs/instrumentation.md` lists for one tower. */
function assertTowerShape(tower: TowerSnapshot): void {
  const what = `tower ${tower.id}`;
  for (const field of [
    "id",
    "col",
    "row",
    "size",
    "rotation",
    "level",
    "heat",
    "redline",
    "heatMult",
    "damage",
    "slowFactor",
    "output",
    "tripTimer",
    "kills",
    "damageDealt",
    "spent",
    "refund",
    "upgradeCost",
  ] as const) {
    assertEqual(typeof tower[field], "number", `${what}: ${field}`);
  }
  for (const field of [
    "tripped",
    "firing",
    "fresh",
    "firingEnabled",
    "thermalEnabled",
  ] as const) {
    assertEqual(typeof tower[field], "boolean", `${what}: ${field}`);
  }
  assertContains(TOWER_TYPES, tower.type, `${what}: type`);
  assertContains([2, 3, 4], tower.size, `${what}: size`);
  assertBetween(tower.rotation, 0, 3, `${what}: rotation`);
  assertBetween(tower.level, 1, 3, `${what}: level`);
  assertBetween(tower.heat, 0, 100, `${what}: heat`);
  assertTrue(
    tower.targeting === null || typeof tower.targeting === "number",
    `${what}: targeting is a number or null`,
  );
  assertTrue(
    Array.isArray(tower.radiatorFaces),
    `${what}: radiatorFaces is an array`,
  );
  for (const face of tower.radiatorFaces) {
    assertContains(FACES, face, `${what}: a radiator face`);
  }
}

/** Every field `specs/instrumentation.md` lists for one surge unit. */
function assertUnitShape(unit: UnitSnapshot): void {
  const what = `unit ${unit.id}`;
  for (const field of [
    "id",
    "x",
    "y",
    "col",
    "row",
    "hp",
    "maxHp",
    "speed",
    "baseSpeed",
    "slowFactor",
    "slowTimer",
    "remaining",
  ] as const) {
    assertEqual(typeof unit[field], "number", `${what}: ${field}`);
  }
  for (const field of ["slowed", "flying", "motion"] as const) {
    assertEqual(typeof unit[field], "boolean", `${what}: ${field}`);
  }
  assertContains(SURGE_TYPES, unit.type, `${what}: type`);
  assertContains(VENTS, unit.vent, `${what}: vent`);
  assertContains(EXHAUSTS, unit.exhaust, `${what}: exhaust`);
}

/** Every field of the run the snapshot opens with. */
function assertRunShape(snapshot: MeltdownSnapshot): void {
  for (const field of [
    "version",
    "menuIndex",
    "money",
    "lives",
    "score",
    "wave",
    "waveCount",
    "startMoney",
    "startLives",
    "buildTimer",
    "wavePending",
    "waveRemaining",
    "speed",
    "simTime",
  ] as const) {
    assertEqual(typeof snapshot[field], "number", `snapshot: ${field}`);
  }
  for (const field of ["interest", "muted", "waveSpawning"] as const) {
    assertEqual(typeof snapshot[field], "boolean", `snapshot: ${field}`);
  }
  assertContains(SCREENS, snapshot.screen, "snapshot: screen");
  assertContains(PHASES, snapshot.phase, "snapshot: phase");
  assertContains(MODES, snapshot.mode, "snapshot: mode");
  assertContains(DIFFICULTIES, snapshot.difficulty, "snapshot: difficulty");
  assertContains([1, 2], snapshot.speed, "snapshot: speed");

  assertHasProperty(snapshot, "nextWave", "snapshot: nextWave");
  if (snapshot.nextWave !== null) {
    assertContains(SURGE_TYPES, snapshot.nextWave.type, "nextWave: type");
    assertEqual(typeof snapshot.nextWave.count, "number", "nextWave: count");
  }
  assertHasProperty(snapshot, "buildZone", "snapshot: buildZone");
  if (snapshot.buildZone !== null) {
    for (const field of ["col0", "row0", "col1", "row1"] as const) {
      assertEqual(
        typeof snapshot.buildZone[field],
        "number",
        `buildZone: ${field}`,
      );
    }
  }
  // Never null: the floor can never be sealed (specs/mazing.md).
  assertEqual(typeof snapshot.paths.left.length, "number", "paths.left.length");
  assertEqual(typeof snapshot.paths.top.length, "number", "paths.top.length");
}

/** Every control the build panel reports, as the specification lists them. */
function assertControlsShape(snapshot: MeltdownSnapshot): void {
  const { controls } = snapshot;
  assertLength(
    controls.shop,
    TOWER_TYPES.length,
    "controls.shop: one entry per tower type",
  );
  for (const entry of controls.shop) {
    assertRect(entry, `controls.shop ${entry.type}`);
    assertContains(TOWER_TYPES, entry.type, "controls.shop: type");
  }
  // A placement is armed and a tower is selected on the posed floor, so all four
  // of the conditional controls are rectangles here rather than `null`.
  assertRect(controls.rotate, "controls.rotate, with a placement armed");
  assertRect(controls.cancel, "controls.cancel, with a placement armed");
  assertRect(controls.upgrade, "controls.upgrade, with a tower selected");
  assertRect(controls.sell, "controls.sell, with a tower selected");
  for (const name of ["send", "speed", "pause", "mute"] as const) {
    assertRect(controls[name], `controls.${name}`);
  }
}

it("reports every documented field, on a floor that exercises each of them", async () => {
  startRun(h);

  // One tower of each footprint size, at the three levels and three heats, and
  // the 4x4 tripped with its cooldown running.
  const arcSite = quietSite(0);
  const bloomSite = quietSite(1);
  const lanceSite = quietSite(2);
  h.debug.addTower("arc", arcSite.col, arcSite.row, 0);
  const arc = h.snapshot().towers[0].id;
  h.debug.addTower("bloom", bloomSite.col, bloomSite.row, 1);
  const bloom = h.snapshot().towers[1].id;
  h.debug.addTower("lance", lanceSite.col, lanceSite.row, 2);
  const lance = h.snapshot().towers[2].id;
  h.debug.setTowerHeat(arc, ARC_HEAT);
  h.debug.setTowerHeat(bloom, BLOOM_HEAT);
  h.debug.setTowerHeat(lance, LANCE_HEAT);
  h.debug.setTowerLevel(bloom, 2);
  h.debug.setTowerLevel(lance, 3);
  h.debug.setTowerTripped(lance, true);
  h.debug.setTowerTripTimer(lance, LANCE_TRIP_TIMER);

  // Both movers, whose heat figures the specification fixes at `0`.
  const forgeSite = quietSite(3);
  const sinkSite = quietSite(4);
  h.debug.addTower("forge", forgeSite.col, forgeSite.row, 0);
  h.debug.addTower("sink", sinkSite.col, sinkSite.row, 0);

  // One unit of every type, on a band of the floor no posed tower reaches.
  SURGE_TYPES.forEach((type, index) => {
    h.debug.addUnit(type, index % 2 === 0 ? "left" : "top");
    const surge = h.snapshot().surge;
    const unit = surge[surge.length - 1];
    const at = tileCenter(5 + index * 5, 30);
    h.debug.setUnitPosition(unit.id, at.x, at.y);
  });

  // A held preview and a selection, which is what makes all four conditional
  // panel controls rectangles.
  h.debug.setArmed("flak");
  h.debug.setPreviewRotation(1);
  h.debug.setPreview(44, 30);
  h.debug.setSelected(arc);
  h.debug.setHoverShop("rime");

  await h.advance(SETTLE_FRAMES);
  captureStill(h, "posed");

  // The press is last, and nothing is advanced after it.
  h.debug.pointerDown(PRESS_X, PRESS_Y);
  const snapshot = h.snapshot();

  assertRunShape(snapshot);
  assertControlsShape(snapshot);

  assertEqual(snapshot.pointer.x, PRESS_X, "pointer.x, at the posed press");
  assertEqual(snapshot.pointer.y, PRESS_Y, "pointer.y, at the posed press");
  assertEqual(snapshot.pointer.down, true, "pointer.down, with a press held");

  assertEqual(snapshot.selected, arc, "selected");
  assertEqual(snapshot.hoverShop, "rime", "hoverShop");
  assertNotNull(snapshot.build, "build, with a placement armed");
  const build = snapshot.build;
  if (build !== null) {
    assertContains(TOWER_TYPES, build.type, "build: type");
    assertEqual(typeof build.col, "number", "build: col");
    assertEqual(typeof build.row, "number", "build: row");
    assertBetween(build.rotation, 0, 3, "build: rotation");
    assertEqual(typeof build.valid, "boolean", "build: valid");
  }

  assertLength(snapshot.towers, 5, "the towers the floor was posed with");
  for (const tower of snapshot.towers) assertTowerShape(tower);
  assertLength(
    snapshot.surge,
    SURGE_TYPES.length,
    "the units the floor was posed with",
  );
  for (const unit of snapshot.surge) assertUnitShape(unit);

  // The three sizes and both movers really are on the floor the shape was read
  // off, so the reading covered every branch it claims to.
  assertEqual(
    readTower(snapshot, arc, "the posed Arc").size,
    2,
    "the Arc's size",
  );
  assertEqual(
    readTower(snapshot, bloom, "the posed Bloom").size,
    3,
    "the Bloom's size",
  );
  assertEqual(
    readTower(snapshot, lance, "the posed Lance").size,
    4,
    "the Lance's size",
  );

  // `simTime` accumulates the game time the simulation advanced by, so four
  // frames of it are on the clock.
  assertGreaterThan(snapshot.simTime, 0, "simTime after four frames");
  assertGreaterThanOrEqual(snapshot.version, 1, "version");
});
