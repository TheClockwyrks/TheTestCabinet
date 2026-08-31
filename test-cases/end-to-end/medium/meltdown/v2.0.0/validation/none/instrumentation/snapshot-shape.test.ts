// Meltdown — instrumentation/snapshot-shape: `snapshot` returns the whole
// documented object, every field present and of its documented type.
//
// WHY THE SHAPE IS A POINT OF ITS OWN. `specs/instrumentation.md` says snapshot
// "returns exactly this object", and every other automated item in this suite
// reads its verdict off one of those fields. A build that reports fifty of the
// fifty-four names hides whichever items read the other four, and the grade would
// otherwise blame those items rather than the surface. So the shape is decided
// once, here, against a floor posed to make every field reachable.
//
// WHAT IS ASSERTED, AND WHAT IS NOT. Presence and TYPE only. Whether `heatMult`
// is the right multiplier belongs to `heat/*`, whether `paths.left.length` is the
// right route length to `mazing/*`, whether `startMoney` follows the mode to
// `instrumentation/derived-fields-follow`. Reading those here would make one
// failure look like fifty.
//
// WHY THE FLOOR IS POSED THIS WAY. Six of the documented fields are legitimately
// `null` on a bare floor — `nextWave`, `selected`, `build`, `buildZone`, and the
// panel's `rotate`, `cancel`, `upgrade` and `sell` — so a bare floor would leave
// their inner shape unchecked. The scenario therefore arms a preview, selects a
// tower, and is played on BOTTLENECK, the one mode that fixes a build zone
// (`specs/modes.md`), so every nullable field carries a value and every inner
// shape is read. Towers of all three footprint sizes at three levels and three
// heats, one of them tripped, a Forge and a Sink, and one unit of each of the six
// surge types cover the two rosters' own shapes; the pointer is pressed so
// `pointer.down` is read true rather than at its default.
//
// THE PRESS COMES BEFORE THE ARMING, deliberately. `pointerDown` feeds the real
// pointer path (`specs/instrumentation.md`), so a press on the floor with a
// placement armed would commit it (`specs/building.md`) — a placement this point
// never asked for. Pressed first, then armed, the press is a press and nothing
// more.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertBetween,
  assertContains,
  assertEqual,
  assertHasProperty,
  assertLength,
  assertNotNull,
} from "../assert";
import {
  DIFFICULTIES,
  MODES,
  SURGE_TYPES,
  TOWER_TYPES,
  tileCX,
  tileCY,
  TRIP_TIME,
  type Rect,
  type SurgeType,
  type TowerType,
} from "../constants";
import { freeSite, IN_ZONE_SITE } from "../fixtures";
import {
  captureStill,
  createHarness,
  poseTower,
  poseWalker,
  requireTower,
  startRun,
  type Harness,
  type MeltdownSnapshot,
} from "../harness";

/** The three heats the posed emitters carry: cold, mid-scale, and near the trip. */
const POSED_HEATS: readonly number[] = [12, 55, 90];

/** The three footprint sizes `specs/towers.md` gives, and a type of each. */
const SIZED_TYPES: readonly TowerType[] = ["arc", "bloom", "lance"];

let h: Harness;

/** `typeof value` is `expected`. The whole vocabulary this point needs. */
function assertType(value: unknown, expected: string, what: string): void {
  assertEqual(typeof value, expected, what);
}

/** A control rectangle: four numbers, present and numeric. */
function assertRect(rect: Rect, what: string): void {
  assertType(rect.x, "number", `${what}.x`);
  assertType(rect.y, "number", `${what}.y`);
  assertType(rect.w, "number", `${what}.w`);
  assertType(rect.h, "number", `${what}.h`);
}

/** A panel control the scenario posed the precondition for: present, and a rect. */
function assertPresentRect(rect: Rect | null, what: string): void {
  assertNotNull(rect, what);
  assertRect(rect as Rect, what);
}
/** An array of world-oriented face names, every entry one of the four sides. */
function assertFaces(value: readonly string[], what: string): void {
  assertEqual(Array.isArray(value), true, what);
  for (const [index, side] of value.entries()) {
    assertContains(["N", "E", "S", "W"], side, `${what}[${index}]`);
  }
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the whole documented shape over a fully posed floor", async () => {
  // Bottleneck, so `buildZone` carries a value rather than the `null` every other
  // mode gives it (specs/modes.md).
  await startRun(h, "bottleneck");

  // Three footprint sizes, three levels, three heats.
  const emitters: number[] = [];
  for (const [index, type] of SIZED_TYPES.entries()) {
    const site = freeSite(index);
    const id = await poseTower(h, type, site.col, site.row, 1);
    await h.debug.setTowerLevel(id, index + 1);
    await h.debug.setTowerHeat(id, POSED_HEATS[index]);
    emitters.push(id);
  }
  // One of them tripped, with its cooldown running.
  await h.debug.setTowerTripped(emitters[2], true);
  await h.debug.setTowerTripTimer(emitters[2], TRIP_TIME);

  // The two movers, whose reported figures are the other half of the roster's
  // shape: `output` carries a value and `heat`, `heatMult` and `damage` do not.
  const forge = freeSite(3);
  await poseTower(h, "forge", forge.col, forge.row);
  const sink = freeSite(4);
  await poseTower(h, "sink", sink.col, sink.row);

  // One unit of every surge type, so the flyer's shape is read beside a walker's.
  for (const [index, type] of SURGE_TYPES.entries()) {
    await poseWalker(h, type, index % 2 === 0 ? "left" : "top");
  }

  // A pressed pointer, BEFORE anything is armed.
  const press = { x: tileCX(freeSite(5).col), y: tileCY(freeSite(5).row) };
  await h.debug.pointerMove(press.x, press.y);
  await h.debug.pointerDown(press.x, press.y);

  // A held preview, a hovered shop entry and a selection, so the panel reports
  // its Rotate, Cancel, Upgrade and Sell controls (specs/hud.md).
  await h.debug.setArmed("arc");
  await h.debug.setPreview(IN_ZONE_SITE.col, IN_ZONE_SITE.row);
  await h.debug.setPreviewRotation(2);
  await h.debug.setHoverShop("stutter");
  await h.debug.setSelected(emitters[0]);

  await h.advance(1);
  // The frame the snapshot below is read off.
  await captureStill(h, "posed");

  const s: MeltdownSnapshot = await h.snapshot();

  /* ---- The run ----------------------------------------------------------- */
  assertType(s.version, "number", "version");
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
    "screen",
  );
  assertContains(["opening", "building", "wave"], s.phase, "phase");
  assertType(s.menuIndex, "number", "menuIndex");
  assertContains([...MODES], s.mode, "mode");
  assertContains([...DIFFICULTIES], s.difficulty, "difficulty");
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
    "simTime",
  ] as const) {
    assertType(s[field], "number", field);
  }
  assertType(s.interest, "boolean", "interest");
  assertType(s.muted, "boolean", "muted");
  assertType(s.waveSpawning, "boolean", "waveSpawning");
  assertType(s.autoStep, "boolean", "autoStep");
  assertContains([1, 2], s.speed, "speed");

  /* ---- The coming wave --------------------------------------------------- */
  assertHasProperty(s, "nextWave", "nextWave");
  assertNotNull(s.nextWave, "nextWave, in a build phase of a 20-wave run");
  assertContains([...SURGE_TYPES], s.nextWave?.type, "nextWave.type");
  assertType(s.nextWave?.count, "number", "nextWave.count");

  /* ---- The pointer ------------------------------------------------------- */
  assertType(s.pointer.x, "number", "pointer.x");
  assertType(s.pointer.y, "number", "pointer.y");
  assertType(s.pointer.down, "boolean", "pointer.down");
  assertEqual(s.pointer.down, true, "pointer.down, with the pointer pressed");

  /* ---- Building ---------------------------------------------------------- */
  assertType(s.selected, "number", "selected, with a tower selected");
  assertContains([...TOWER_TYPES], s.hoverShop, "hoverShop");
  assertNotNull(s.build, "build, with a placement armed");
  assertContains([...TOWER_TYPES], s.build?.type, "build.type");
  assertType(s.build?.col, "number", "build.col");
  assertType(s.build?.row, "number", "build.row");
  assertContains([0, 1, 2, 3], s.build?.rotation, "build.rotation");
  assertType(s.build?.valid, "boolean", "build.valid");

  /* ---- The zone and the routes ------------------------------------------ */
  assertHasProperty(s, "buildZone", "buildZone");
  assertNotNull(s.buildZone, "buildZone, on Bottleneck");
  for (const corner of ["col0", "row0", "col1", "row1"] as const) {
    assertType(s.buildZone?.[corner], "number", `buildZone.${corner}`);
  }
  assertType(s.paths.left.length, "number", "paths.left.length");
  assertType(s.paths.top.length, "number", "paths.top.length");

  /* ---- The panel's controls --------------------------------------------- */
  // One entry per type, in the shop order `specs/hud.md` fixes.
  assertLength(s.controls.shop, TOWER_TYPES.length, "controls.shop");
  for (const [index, type] of TOWER_TYPES.entries()) {
    const entry = s.controls.shop[index];
    assertEqual(entry.type, type, `controls.shop[${index}].type`);
    assertRect(entry, `controls.shop[${index}]`);
  }
  // Four are null with nothing armed and nothing selected; this floor posed both.
  assertPresentRect(s.controls.rotate, "controls.rotate, with a placement armed");
  assertPresentRect(s.controls.cancel, "controls.cancel, with a placement armed");
  assertPresentRect(s.controls.upgrade, "controls.upgrade, with a tower selected");
  assertPresentRect(s.controls.sell, "controls.sell, with a tower selected");
  for (const name of ["send", "speed", "pause", "mute"] as const) {
    assertRect(s.controls[name], `controls.${name}`);
  }

  /* ---- The towers ------------------------------------------------------- */
  assertLength(s.towers, SIZED_TYPES.length + 2, "the posed tower roster");
  for (const tower of s.towers) {
    const what = `towers[id ${String(tower.id)}]`;
    assertType(tower.id, "number", `${what}.id`);
    assertContains([...TOWER_TYPES], tower.type, `${what}.type`);
    for (const field of [
      "col",
      "row",
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
      assertType(tower[field], "number", `${what}.${field}`);
    }
    assertContains([2, 3, 4], tower.size, `${what}.size`);
    assertContains([0, 1, 2, 3], tower.rotation, `${what}.rotation`);
    for (const field of [
      "tripped",
      "firing",
      "fresh",
      "firingEnabled",
      "thermalEnabled",
    ] as const) {
      assertType(tower[field], "boolean", `${what}.${field}`);
    }
    assertHasProperty(tower, "targeting", `${what}.targeting`);
    if (tower.targeting !== null) {
      assertType(tower.targeting, "number", `${what}.targeting`);
    }
    assertFaces(tower.radiatorFaces, `${what}.radiatorFaces`);
  }

  /* ---- The surge -------------------------------------------------------- */
  assertLength(s.surge, SURGE_TYPES.length, "the posed surge roster");
  for (const unit of s.surge) {
    const what = `surge[id ${String(unit.id)}]`;
    assertType(unit.id, "number", `${what}.id`);
    assertContains([...SURGE_TYPES], unit.type as SurgeType, `${what}.type`);
    for (const field of [
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
      assertType(unit[field], "number", `${what}.${field}`);
    }
    assertType(unit.slowed, "boolean", `${what}.slowed`);
    assertType(unit.flying, "boolean", `${what}.flying`);
    assertType(unit.motion, "boolean", `${what}.motion`);
    assertContains(["left", "top"], unit.vent, `${what}.vent`);
    assertContains(["right", "bottom"], unit.exhaust, `${what}.exhaust`);
  }

  // And the tripped tower is reported as such, so the roster's shape was read off
  // the floor this point posed rather than off a default object.
  assertEqual(
    requireTower(s, emitters[2], "the tripped tower").tripped,
    true,
    "the posed trip is reported",
  );
  assertBetween(
    requireTower(s, emitters[0], "the cold tower").heat,
    0,
    100,
    "a reported heat is on the 0-100 scale (specs/heat.md)",
  );
});
