// instrumentation/snapshot-shape — `snapshot()` reports the whole document
// `specs/instrumentation.md` writes out, off a yard that exercises every branch
// of it.
//
// A snapshot is the only window every other point in this project reads the game
// through, so a field that is missing, or that reports a string where a number
// belongs, hides whatever it was supposed to say. The yard posed below carries
// one of each thing the shape has a branch for — a candidate, a component, a
// blocker, a combination tower, a live ground unit, and a projectile in flight —
// so no branch is left unread.
//
// WHAT THIS DOES NOT DECIDE. Whether each figure is the RIGHT figure: what a
// Capacitor's damage is at Charged, where a projectile goes, what a slow does.
// Those are the components, firing and abilities points. This one decides the
// shape and the derivations `specs/instrumentation.md` states for the report
// itself: the version, the field set, each field's documented type, and the
// derived reads it fixes there — a blocker's null type and zero range, a
// structure's center from its anchor, `progress` in tiles, `waypointIndex` in
// `1`–`7`, and the Overload Dynamo's `invincible`.

import { afterEach, beforeEach, it } from "vitest";

import {
  COMBO_IDS,
  COMPONENT_TYPES,
  DIFFICULTY_IDS,
  MAP_IDS,
  SCREENS,
  SPEEDS,
  TARGETING_PRIORITIES,
} from "../../src/constants";
import {
  assertBetween,
  assertContains,
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertHasProperty,
  assertLength,
  assertNull,
  assertTrue,
} from "../assert";
import {
  FOUNDRY_DEBUG_VERSION,
  SPAWN_TYPES,
  captureStill,
  createHarness,
  mapById,
  openYard,
  parkUnit,
  standBlocker,
  standCandidate,
  standCombo,
  standComponent,
  structureById,
  structureCenter,
  tileCenter,
  unitById,
  type FoundrySnapshot,
  type Harness,
} from "../harness";

/** A wave deep enough that the posed target survives whatever is shot at it. */
const WAVE = 30;

/** The four anchors the posed structures take, clear of every platform. */
const COMPONENT_AT = { col: 20, row: 10 };
const COMBO_AT = { col: 24, row: 10 };
const BLOCKER_AT = { col: 28, row: 10 };
const CANDIDATE_AT = { col: 32, row: 10 };

/** Where the target stands: inside the component's range and nothing else's. */
const TARGET_AT = tileCenter(23, 10);

/** How long a projectile is waited for, in frames of the suite's 120 Hz clock. */
const FIRE_FRAMES = 1200;

/** Every field `specs/instrumentation.md` writes into the snapshot document. */
const SNAPSHOT_FIELDS = [
  "version",
  "screen",
  "phase",
  "menuIndex",
  "paused",
  "map",
  "difficulty",
  "wave",
  "totalWaves",
  "waveActive",
  "charge",
  "integrity",
  "refinement",
  "qualityOdds",
  "nextRoll",
  "stampsLeft",
  "speed",
  "muted",
  "overlays",
  "mazeLength",
  "mazeRating",
  "selected",
  "combineSet",
  "pointer",
  "held",
  "entry",
  "collector",
  "waypoints",
  "units",
  "structures",
  "projectiles",
  "simTime",
] as const;

/** Every field a `units` entry carries. */
const UNIT_FIELDS = [
  "id",
  "type",
  "x",
  "y",
  "hp",
  "maxHp",
  "speed",
  "baseSpeed",
  "flying",
  "frozen",
  "waypointIndex",
  "progress",
  "slowFactor",
  "slowUntil",
  "burnDps",
  "burnUntil",
  "invincible",
] as const;

/** Every field a `structures` entry carries. */
const STRUCTURE_FIELDS = [
  "id",
  "kind",
  "type",
  "quality",
  "level",
  "col",
  "row",
  "cx",
  "cy",
  "range",
  "damage",
  "fireRate",
  "targeting",
  "heading",
  "firing",
  "kills",
  "damageDealt",
  "auraRadius",
  "auraBonus",
  "abilities",
] as const;

/** Every field a `projectiles` entry carries. */
const PROJECTILE_FIELDS = [
  "id",
  "x",
  "y",
  "vx",
  "vy",
  "type",
  "heading",
  "damage",
  "targetId",
] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Every documented field is present and carries `kind`. */
function fieldsAre(
  subject: object,
  fields: readonly string[],
  kind: string,
  where: string,
): void {
  for (const field of fields) {
    assertHasProperty(subject, field, `${where}.${field}`);
  }
  for (const field of fields) {
    const held = (subject as Record<string, unknown>)[field];
    assertEqual(typeof held, kind, `typeof ${where}.${field}`);
  }
}

it("reports the whole documented shape off a fully posed yard", async () => {
  openYard(h, { wave: WAVE, charge: 500 });

  // One of everything the shape branches on. The structures stand first, because
  // a placement is refused under a unit; the target is posed after them.
  const component = standComponent(
    h,
    "discharge",
    5,
    COMPONENT_AT.col,
    COMPONENT_AT.row,
  );
  const tower = standCombo(h, "nullcore", COMBO_AT.col, COMBO_AT.row, 2);
  const blocker = standBlocker(h, BLOCKER_AT.col, BLOCKER_AT.row);
  const candidate = standCandidate(
    h,
    "regulator",
    3,
    CANDIDATE_AT.col,
    CANDIDATE_AT.row,
  );
  // The Overload Dynamo, so `invincible` is read on the one unit that carries it,
  // and held so the target the projectile is chasing does not move.
  const target = parkUnit(h, "overload", TARGET_AT);

  // Run until a shot is in the air. The projectile is a live branch of the shape
  // rather than a posed one: `specs/instrumentation.md` carries no operation that
  // makes one, so the structure's own firing is what puts it there.
  const flying = await h.until((s) => s.projectiles.length > 0, {
    maxFrames: FIRE_FRAMES,
  });
  captureStill(h, "posed");
  assertEqual(
    flying.hit,
    true,
    "a projectile in flight, so the projectiles branch of the shape is read",
  );

  const s: FoundrySnapshot = flying.snapshot;

  /* ---- The document itself --------------------------------------------- */

  for (const field of SNAPSHOT_FIELDS) {
    assertHasProperty(s, field, `snapshot().${field}`);
  }
  assertEqual(s.version, FOUNDRY_DEBUG_VERSION, "snapshot().version");
  assertContains(SCREENS, s.screen, "snapshot().screen");
  assertContains(["build", "wave", "finale"], s.phase, "snapshot().phase");
  assertEqual(typeof s.menuIndex, "number", "typeof snapshot().menuIndex");
  assertEqual(typeof s.paused, "boolean", "typeof snapshot().paused");
  assertContains(MAP_IDS, s.map, "snapshot().map");
  assertContains(DIFFICULTY_IDS, s.difficulty, "snapshot().difficulty");
  assertEqual(typeof s.wave, "number", "typeof snapshot().wave");
  assertEqual(typeof s.totalWaves, "number", "typeof snapshot().totalWaves");
  assertEqual(typeof s.waveActive, "boolean", "typeof snapshot().waveActive");
  assertEqual(typeof s.charge, "number", "typeof snapshot().charge");
  assertEqual(typeof s.integrity, "number", "typeof snapshot().integrity");
  assertEqual(typeof s.refinement, "number", "typeof snapshot().refinement");
  assertLength(s.qualityOdds, 5, "snapshot().qualityOdds");
  assertEqual(typeof s.stampsLeft, "number", "typeof snapshot().stampsLeft");
  assertContains(SPEEDS, s.speed, "snapshot().speed");
  assertEqual(typeof s.muted, "boolean", "typeof snapshot().muted");
  fieldsAre(s.overlays, ["combos", "damage"], "boolean", "snapshot().overlays");
  assertEqual(typeof s.mazeLength, "number", "typeof snapshot().mazeLength");
  assertEqual(typeof s.mazeRating, "number", "typeof snapshot().mazeRating");
  fieldsAre(s.pointer, ["x", "y"], "number", "snapshot().pointer");
  assertEqual(typeof s.held.active, "boolean", "typeof snapshot().held.active");
  fieldsAre(s.held, ["col", "row"], "number", "snapshot().held");
  assertEqual(typeof s.held.legal, "boolean", "typeof snapshot().held.legal");
  fieldsAre(s.entry, ["col", "row"], "number", "snapshot().entry");
  fieldsAre(s.collector, ["col", "row"], "number", "snapshot().collector");
  assertEqual(typeof s.simTime, "number", "typeof snapshot().simTime");

  // The odds are a distribution: five tiers summing to one.
  const odds = s.qualityOdds.reduce((sum, share) => sum + share, 0);
  assertBetween(odds, 0.999, 1.001, "snapshot().qualityOdds summed");

  // The chain is numbered from 1 and runs 1..6, in order.
  assertLength(s.waypoints, 6, "snapshot().waypoints");
  for (const [at, waypoint] of s.waypoints.entries()) {
    fieldsAre(
      waypoint,
      ["index", "col", "row"],
      "number",
      `snapshot().waypoints[${at}]`,
    );
    assertEqual(waypoint.index, at + 1, `snapshot().waypoints[${at}].index`);
  }

  /* ---- The structures --------------------------------------------------- */

  assertLength(s.structures, 4, "snapshot().structures");
  for (const [at, structure] of s.structures.entries()) {
    for (const field of STRUCTURE_FIELDS) {
      assertHasProperty(structure, field, `snapshot().structures[${at}]`);
    }
    const where = `snapshot().structures[#${structure.id}]`;
    fieldsAre(
      structure,
      [
        "id",
        "col",
        "row",
        "cx",
        "cy",
        "range",
        "damage",
        "fireRate",
        "heading",
        "kills",
        "damageDealt",
        "auraRadius",
        "auraBonus",
      ],
      "number",
      where,
    );
    assertEqual(typeof structure.firing, "boolean", `typeof ${where}.firing`);
    assertContains(
      ["candidate", "component", "combo", "blocker"],
      structure.kind,
      `${where}.kind`,
    );
    assertTrue(
      Array.isArray(structure.abilities),
      `${where}.abilities to be an array of names`,
    );
    // The center is derived from the anchor, as `specs/yard.md` fixes it.
    const center = structureCenter(structure.col, structure.row);
    assertEqual(structure.cx, center.x, `${where}.cx`);
    assertEqual(structure.cy, center.y, `${where}.cy`);
  }

  const posedComponent = structureById(s, component);
  assertEqual(posedComponent.kind, "component");
  assertContains(COMPONENT_TYPES, posedComponent.type, "a component's type");
  assertEqual(posedComponent.quality, 5);
  assertNull(posedComponent.level, "a base component's level");
  assertContains(
    TARGETING_PRIORITIES,
    posedComponent.targeting,
    "a firing structure's targeting",
  );

  const posedCandidate = structureById(s, candidate);
  assertEqual(posedCandidate.kind, "candidate");
  assertEqual(posedCandidate.quality, 3);
  assertNull(posedCandidate.level, "a candidate's level");

  const posedTower = structureById(s, tower);
  assertEqual(posedTower.kind, "combo");
  assertContains(COMBO_IDS, posedTower.type, "a combination tower's type");
  assertNull(posedTower.quality, "a combination tower's quality");
  assertEqual(posedTower.level, 2);

  // A blocker reports a null type and zero damage and range
  // (`specs/instrumentation.md`).
  const posedBlocker = structureById(s, blocker);
  assertEqual(posedBlocker.kind, "blocker");
  assertNull(posedBlocker.type, "a blocker's type");
  assertNull(posedBlocker.quality, "a blocker's quality");
  assertNull(posedBlocker.level, "a blocker's level");
  assertEqual(posedBlocker.damage, 0, "a blocker's damage");
  assertEqual(posedBlocker.range, 0, "a blocker's range");
  assertNull(posedBlocker.targeting, "a blocker's targeting");

  /* ---- The units -------------------------------------------------------- */

  assertLength(s.units, 1, "snapshot().units");
  const posedUnit = unitById(s, target);
  for (const field of UNIT_FIELDS) {
    assertHasProperty(posedUnit, field, `snapshot().units[#${target}]`);
  }
  const unitWhere = `snapshot().units[#${target}]`;
  fieldsAre(
    posedUnit,
    [
      "id",
      "x",
      "y",
      "hp",
      "maxHp",
      "speed",
      "baseSpeed",
      "waypointIndex",
      "progress",
      "slowFactor",
      "slowUntil",
      "burnDps",
      "burnUntil",
    ],
    "number",
    unitWhere,
  );
  fieldsAre(
    posedUnit,
    ["flying", "frozen", "invincible"],
    "boolean",
    unitWhere,
  );
  assertContains(SPAWN_TYPES, posedUnit.type, `${unitWhere}.type`);
  // The chain the unit is walking is numbered 1..7, where 7 is the collector.
  assertBetween(posedUnit.waypointIndex, 1, 7, `${unitWhere}.waypointIndex`);
  // `progress` is a remaining route length in TILES, so it is never negative and
  // never longer than the whole ground route the same snapshot reports.
  assertGreaterThanOrEqual(posedUnit.progress, 0, `${unitWhere}.progress`);
  assertGreaterThan(s.mazeLength, 0, "snapshot().mazeLength on a walked yard");
  assertTrue(
    posedUnit.progress <= s.mazeLength,
    `${unitWhere}.progress, a remaining route length in tiles, to be at most ` +
      `the whole ground route (${s.mazeLength} tiles)`,
  );
  // The Overload Dynamo is the one unit that cannot be killed.
  assertEqual(posedUnit.invincible, true, `${unitWhere}.invincible`);
  assertEqual(posedUnit.frozen, true, `${unitWhere}.frozen`);

  /* ---- The projectiles -------------------------------------------------- */

  for (const [at, projectile] of s.projectiles.entries()) {
    for (const field of PROJECTILE_FIELDS) {
      assertHasProperty(projectile, field, `snapshot().projectiles[${at}]`);
    }
    const where = `snapshot().projectiles[${at}]`;
    fieldsAre(
      projectile,
      ["id", "x", "y", "vx", "vy", "heading", "damage"],
      "number",
      where,
    );
    assertEqual(typeof projectile.type, "string", `typeof ${where}.type`);
    assertTrue(
      projectile.targetId === null || typeof projectile.targetId === "number",
      `${where}.targetId to be a unit id or null`,
    );
  }

  /* ---- And the reads that come off the map ------------------------------ */

  const map = mapById(s.map);
  assertEqual(s.entry.col, map.entry.col, "snapshot().entry.col");
  assertEqual(s.entry.row, map.entry.row, "snapshot().entry.row");
  assertEqual(s.collector.col, map.collector.col, "snapshot().collector.col");
  assertEqual(s.collector.row, map.collector.row, "snapshot().collector.row");
});
