// Meltdown — instrumentation/snapshot-shape: the snapshot reports the full
// documented shape.
//
// specs/instrumentation.md, Snapshot shape: "`snapshot` returns exactly this
// object. Every field an operation can set is present, so every operation is
// verifiable by setting a value and reading it back." This point reads the SHAPE
// — that every field of that block is there, carrying the kind of value the block
// documents. What each field's value must BE is decided by the item that owns it
// (`poses-read-back` for the poses, `derived-fields-follow` for the derived
// figures, `heat`, `combat`, `towers` and `mazing` for the tower and unit
// figures), so nothing here asserts a figure the arrangement did not pose.
//
// ONE FLOOR EXERCISES EVERY BRANCH OF THE SHAPE AT ONCE, which is what makes a
// missing field a failure rather than an absence nobody looked at:
//
//   - all three footprint sizes, at all three levels and at three heats: a 2x2
//     Arc, a 3x3 Bloom and a 4x4 Lance (specs/towers.md), so `size`, `level` and
//     `heat` are each read at more than one value;
//   - one of them tripped, so `tripped` and `tripTimer` are read on a tower that
//     is actually offline;
//   - a Forge and a Sink, the two movers, so `output` and the empty
//     `radiatorFaces` are read on the towers that carry them;
//   - a unit of every one of the six surge types, so `flying`, `vent` and
//     `exhaust` are read across both a walker and the flyer;
//   - an ARMED PREVIEW, which is what makes `build` an object rather than `null`
//     and `controls.rotate` and `controls.cancel` rectangles rather than `null`;
//   - a SELECTION, which is what makes `controls.upgrade` and `controls.sell`
//     rectangles rather than `null`;
//   - a PRESSED POINTER, so `pointer.down` is read as `true`.
//
// THE POINTER IS PRESSED FIRST, BEFORE ANYTHING IS ARMED. specs/controls.md
// resolves an interaction on the release, and a press or a move "only carries the
// preview": a press reported while a preview is held moves that preview to the
// pressed point. Pressing first therefore leaves the preview exactly where
// `setPreview` put it, and the press is still the one the snapshot reports.
//
// AND THE WHOLE SHAPE IS READ FROM THE POSE ITSELF, before any frame runs.
// `snapshot` is a pure reading of the state (specs/instrumentation.md), so every
// field is decidable the moment it is posed — and `pointer` is "refreshed in
// every update", so a frame run first would report the runtime's own idle pointer
// in place of the posed press.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertBetween,
  assertContains,
  assertEqual,
  assertHasProperty,
  assertLength,
  assertNotNull,
  assertTrue,
} from "../assert";
import { SURGE_TYPES, TOWER_TYPES } from "../constants";
import { sizeOf, tileCentre } from "../geometry";
import {
  captureStill,
  createHarness,
  poseTower,
  poseWalker,
  startRun,
  type Harness,
  type MeltdownSnapshot,
  type SurgeType,
  type TowerType,
} from "../harness";
import { MELTDOWN_DEBUG_VERSION } from "../surface";

/** The five towers the floor carries, and the anchor each stands on. */
const FLOOR: ReadonlyArray<{
  type: TowerType;
  col: number;
  row: number;
  level: number;
  heat: number;
}> = [
  { type: "arc", col: 4, row: 4, level: 1, heat: 0 },
  { type: "bloom", col: 8, row: 4, level: 2, heat: 40 },
  { type: "lance", col: 13, row: 4, level: 3, heat: 92 },
  { type: "forge", col: 4, row: 9, level: 2, heat: 0 },
  { type: "sink", col: 8, row: 9, level: 3, heat: 0 },
];

/** The row the six units stand on, and the columns they are spread across. */
const UNIT_ROW = 25;
const UNIT_COLS: readonly number[] = [4, 7, 10, 13, 16, 19];

/** Where the held preview is put, and the rotation it is held at. */
const PREVIEW = { type: "bloom" as TowerType, col: 30, row: 20, rotation: 1 };

/** The floor tile the pointer is pressed on. */
const PRESS = { col: 40, row: 30 };

/** The four faces a `radiatorFaces` entry may name (specs/towers.md). */
const FACES: readonly string[] = ["N", "E", "S", "W"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Pose the floor described above and hand back the snapshot the poses left. */
function poseShape(): MeltdownSnapshot {
  startRun(h);
  h.debug.setPhase("wave");
  h.debug.setWavePending(4);

  const ids = FLOOR.map((entry) => {
    const id = poseTower(h, entry.type, entry.col, entry.row);
    h.debug.setTowerLevel(id, entry.level);
    h.debug.setTowerHeat(id, entry.heat);
    return id;
  });
  // One of them offline on a trip, so `tripped` and `tripTimer` are read on a
  // tower that really is on its cooldown.
  h.debug.setTowerTripped(ids[0], true);
  h.debug.setTowerTripTimer(ids[0], 3.5);

  SURGE_TYPES.forEach((type, index) => {
    const id = poseWalker(
      h,
      type as SurgeType,
      index % 2 === 0 ? "left" : "top",
    );
    const at = tileCentre(UNIT_COLS[index], UNIT_ROW);
    h.debug.setUnitPosition(id, at.x, at.y);
  });

  // The press first, then the preview it must not have moved.
  const pressAt = tileCentre(PRESS.col, PRESS.row);
  h.debug.pointerDown(pressAt.x, pressAt.y);
  h.debug.setArmed(PREVIEW.type);
  h.debug.setPreview(PREVIEW.col, PREVIEW.row);
  h.debug.setPreviewRotation(PREVIEW.rotation);
  h.debug.setSelected(ids[1]);
  h.debug.setHoverShop("lance");

  return h.snapshot();
}

it("reports version 1 and every documented run field with its documented type", async () => {
  const s = poseShape();
  await h.advance(1);
  captureStill(h, "posed");

  assertEqual(s.version, MELTDOWN_DEBUG_VERSION, "version");
  assertContains(
    [
      "title",
      "modeselect",
      "difficultyselect",
      "howto",
      "playing",
      "paused",
      "victory",
      "gameover",
    ],
    s.screen,
    "screen is one of the eight documented screens",
  );
  assertContains(["opening", "building", "wave"], s.phase, "phase");
  assertEqual(typeof s.menuIndex, "number", "menuIndex");
  assertContains(
    ["containment", "hundred", "deeppockets", "bottleneck", "suddendeath"],
    s.mode,
    "mode",
  );
  assertContains(["easy", "medium", "hard"], s.difficulty, "difficulty");

  for (const field of [
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
    assertEqual(typeof s[field], "number", field);
  }
  for (const field of ["interest", "muted", "waveSpawning"] as const) {
    assertEqual(typeof s[field], "boolean", field);
  }

  // `nextWave` is an object here — a `wave` phase of Wave 1 in a twenty-wave run
  // is preparing Wave 2, which is inside the run (specs/instrumentation.md).
  assertNotNull(s.nextWave, "nextWave, on a wave inside the run");
  assertContains(
    SURGE_TYPES as readonly string[],
    s.nextWave?.type,
    "nextWave.type",
  );
  assertEqual(typeof s.nextWave?.count, "number", "nextWave.count");

  // The pointer, as the press posed it.
  assertEqual(typeof s.pointer.x, "number", "pointer.x");
  assertEqual(typeof s.pointer.y, "number", "pointer.y");
  assertEqual(s.pointer.down, true, "pointer.down, with the pointer pressed");

  // The selection, the hover and the held preview.
  assertEqual(typeof s.selected, "number", "selected, with a tower selected");
  assertContains(TOWER_TYPES as readonly string[], s.hoverShop, "hoverShop");
  assertNotNull(s.build, "build, with a placement armed");
  assertContains(TOWER_TYPES as readonly string[], s.build?.type, "build.type");
  assertEqual(typeof s.build?.col, "number", "build.col");
  assertEqual(typeof s.build?.row, "number", "build.row");
  assertEqual(typeof s.build?.rotation, "number", "build.rotation");
  assertEqual(typeof s.build?.valid, "boolean", "build.valid");

  // `buildZone` is present whatever the mode: an object of four tile
  // coordinates, or `null` where the whole floor may be built on.
  assertHasProperty(s, "buildZone");
  if (s.buildZone !== null) {
    for (const field of ["col0", "row0", "col1", "row1"] as const) {
      assertEqual(typeof s.buildZone[field], "number", `buildZone.${field}`);
    }
  }

  // `paths` is never null, because the floor can never be sealed.
  assertEqual(typeof s.paths.left.length, "number", "paths.left.length");
  assertEqual(typeof s.paths.top.length, "number", "paths.top.length");
});

it("reports every control the build panel offers, as a rectangle", async () => {
  const s = poseShape();
  await h.advance(1);

  assertLength(
    s.controls.shop,
    TOWER_TYPES.length,
    "controls.shop carries one entry per shop entry",
  );
  for (const entry of s.controls.shop) {
    assertContains(
      TOWER_TYPES as readonly string[],
      entry.type,
      "a shop entry's type",
    );
    for (const field of ["x", "y", "w", "h"] as const) {
      assertEqual(typeof entry[field], "number", `a shop entry's ${field}`);
    }
  }

  // Four of the controls are `null` only when nothing is armed or nothing is
  // selected; this floor has both, so all eight are rectangles.
  for (const name of [
    "rotate",
    "cancel",
    "upgrade",
    "sell",
    "send",
    "speed",
    "pause",
    "mute",
  ] as const) {
    const rect = s.controls[name];
    assertNotNull(rect, `controls.${name}`);
    for (const field of ["x", "y", "w", "h"] as const) {
      assertEqual(typeof rect?.[field], "number", `controls.${name}.${field}`);
    }
  }
});

it("reports every documented field of every tower and every unit", async () => {
  const s = poseShape();
  await h.advance(1);

  assertLength(s.towers, FLOOR.length, "one towers entry per posed tower");
  for (const tower of s.towers) {
    const at = `tower ${tower.id}`;
    assertContains(TOWER_TYPES as readonly string[], tower.type, `${at}: type`);
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
      assertEqual(typeof tower[field], "number", `${at}: ${field}`);
    }
    for (const field of [
      "tripped",
      "firing",
      "fresh",
      "firingEnabled",
      "thermalEnabled",
    ] as const) {
      assertEqual(typeof tower[field], "boolean", `${at}: ${field}`);
    }
    assertTrue(
      tower.targeting === null || typeof tower.targeting === "number",
      `${at}: targeting is a unit id or null`,
    );
    assertTrue(
      Array.isArray(tower.radiatorFaces),
      `${at}: radiatorFaces is an array`,
    );
    for (const face of tower.radiatorFaces) {
      assertContains(FACES, face, `${at}: a radiatorFaces entry`);
    }
    // `size` is the footprint side specs/towers.md gives the type, so the three
    // sizes the floor carries are each read on the tower that has one.
    assertEqual(tower.size, sizeOf(tower.type), `${at}: size`);
    assertBetween(tower.level, 1, 3, `${at}: level`);
  }

  assertLength(s.surge, SURGE_TYPES.length, "one surge entry per posed unit");
  for (const unit of s.surge) {
    const at = `unit ${unit.id}`;
    assertContains(SURGE_TYPES as readonly string[], unit.type, `${at}: type`);
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
      assertEqual(typeof unit[field], "number", `${at}: ${field}`);
    }
    for (const field of ["slowed", "flying", "motion"] as const) {
      assertEqual(typeof unit[field], "boolean", `${at}: ${field}`);
    }
    assertContains(["left", "top"], unit.vent, `${at}: vent`);
    assertContains(["right", "bottom"], unit.exhaust, `${at}: exhaust`);
  }
});
