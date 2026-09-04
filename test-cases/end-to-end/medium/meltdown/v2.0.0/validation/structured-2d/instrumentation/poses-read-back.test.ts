// Meltdown — instrumentation/poses-read-back: every pose is reported by the
// snapshot.
//
// `specs/instrumentation.md`, Snapshot shape: "Every field an operation can set
// is present, so every operation is verifiable by setting a value and reading it
// back." This point is that verification, run once over the whole surface: every
// pose the specification lists is given a value and the snapshot is asked for it.
//
// EVERY VALUE POSED IS A VALUE NO DEFAULT CARRIES. `reset` restores `menuIndex`
// to `0`, `mode` to `"containment"`, `difficulty` to `"medium"`, `score` to `0`,
// `wave` to `1`, `speed` to `1`, `selected`, `hoverShop` and `build` to `null`,
// and a placed tower opens at heat `0`, level `1`, not tripped, fresh, with both
// faculties on — so a surface whose pose did nothing at all would read the
// default back and every line below would catch it. The figures are also
// mutually distinct (`money` `4321`, `lives` `17`, `score` `987654`, `wave` `13`,
// `wavePending` `42`), so a build that wrote one field's value into another's
// reads a number that belongs to a different pose rather than a plausible one.
//
// EACH READING IS TAKEN WITH NO FRAME BETWEEN THE POSE AND IT. Under this engine
// a pose acts on the live game at the moment of the call and a reading is built
// at the call (`specs/instrumentation.md`), so what a reading here can be
// disturbed by is the surface alone. The pointer is read the same way and for a
// stronger reason: `pointer` mirrors what the pointer input reports and is
// refreshed in every update, so a frame advanced after a posed press would
// report the runtime's idle pointer instead of the press.
//
// MUTE IS NOT IN THE LIST, because there is no `setMuted`: "muting is a player
// preference the runtime owns". What is asserted instead is the consequence —
// `muted` is where it started once every pose above has been made, so no
// operation on this surface reached it.
//
// ORDER, WHERE ORDER IS PART OF THE SPECIFICATION. The rotation is posed after
// the type is armed, because "arming a second type replaces the held one, and
// the held rotation returns to `0`" (`specs/building.md`), and `maxHp` before
// `hp`, so the reading is of two poses rather than of one clamping the other.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertNotNull } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  tileCenter,
  type Harness,
} from "../harness";
import { quietSite, readTower, readUnit } from "./ground";

/** The run figures posed, each one no `reset` restores. */
const MENU_INDEX = 3;
const MONEY = 4321;
const LIVES = 17;
const SCORE = 987_654;
const WAVE = 13;
const BUILD_TIMER = 7.25;
const WAVE_PENDING = 42;
const SPEED = 2;

/** The tower figures posed. */
const HEAT = 63;
const LEVEL = 2;
const TRIP_TIMER = 3.5;

/** The unit figures posed. */
const MAX_HP = 99;
const HP = 55;
const SLOW_FACTOR = 0.4;
const SLOW_TIMER = 1.25;

/** The tile the held preview is posed on, and the rotation it is held at. */
const PREVIEW_COL = 10;
const PREVIEW_ROW = 20;
const PREVIEW_ROTATION = 2;

/** Where the posed press lands, in logical stage units. */
const PRESS_X = 1123;
const PRESS_Y = 77;

/**
 * How far a read-back figure may sit from the figure posed, in the unit of the
 * figure.
 *
 * The reading is taken with no frame advanced, so nothing has run between the
 * pose and it and the only difference a conformant build can introduce is the
 * float it stored the number in. Six decimal places is many orders of magnitude
 * above that and many orders below the smallest step any of these figures takes.
 */
const READBACK_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports back every value the surface's poses set", async () => {
  startRun(h);
  const mutedAtTheStart = h.snapshot().muted;

  // ---- The screen and the run -------------------------------------------
  h.debug.setScreen("howto");
  assertEqual(h.snapshot().screen, "howto", "setScreen");
  h.debug.setPhase("wave");
  assertEqual(h.snapshot().phase, "wave", "setPhase");
  h.debug.setMenuIndex(MENU_INDEX);
  assertEqual(h.snapshot().menuIndex, MENU_INDEX, "setMenuIndex");
  h.debug.setMode("bottleneck");
  assertEqual(h.snapshot().mode, "bottleneck", "setMode");
  h.debug.setDifficulty("hard");
  assertEqual(h.snapshot().difficulty, "hard", "setDifficulty");
  h.debug.setMoney(MONEY);
  assertEqual(h.snapshot().money, MONEY, "setMoney");
  h.debug.setLives(LIVES);
  assertEqual(h.snapshot().lives, LIVES, "setLives");
  h.debug.setScore(SCORE);
  assertEqual(h.snapshot().score, SCORE, "setScore");
  h.debug.setWave(WAVE);
  assertEqual(h.snapshot().wave, WAVE, "setWave");
  h.debug.setBuildTimer(BUILD_TIMER);
  assertCloseTo(
    h.snapshot().buildTimer,
    BUILD_TIMER,
    READBACK_DIGITS,
    "setBuildTimer",
  );
  h.debug.setWavePending(WAVE_PENDING);
  assertEqual(h.snapshot().wavePending, WAVE_PENDING, "setWavePending");
  h.debug.setSpeed(SPEED);
  assertEqual(h.snapshot().speed, SPEED, "setSpeed");

  // ---- The world gate, in both directions --------------------------------
  h.debug.setWaveSpawning(true);
  assertEqual(h.snapshot().waveSpawning, true, "setWaveSpawning(true)");
  h.debug.setWaveSpawning(false);
  assertEqual(h.snapshot().waveSpawning, false, "setWaveSpawning(false)");

  // ---- One tower ---------------------------------------------------------
  const site = quietSite(0);
  h.debug.addTower("arc", site.col, site.row, 0);
  const towers = h.snapshot().towers;
  assertEqual(towers.length, 1, "the towers addTower left on the floor");
  const towerId = towers[towers.length - 1].id;

  h.debug.setTowerHeat(towerId, HEAT);
  h.debug.setTowerLevel(towerId, LEVEL);
  h.debug.setTowerFresh(towerId, false);
  h.debug.setTowerTripped(towerId, true);
  h.debug.setTowerTripTimer(towerId, TRIP_TIMER);
  h.debug.setTowerFiring(towerId, false);
  h.debug.setTowerThermal(towerId, false);

  const tower = readTower(h.snapshot(), towerId, "the posed tower");
  assertCloseTo(tower.heat, HEAT, READBACK_DIGITS, "setTowerHeat");
  assertEqual(tower.level, LEVEL, "setTowerLevel");
  assertEqual(tower.fresh, false, "setTowerFresh");
  assertEqual(tower.tripped, true, "setTowerTripped");
  assertCloseTo(
    tower.tripTimer,
    TRIP_TIMER,
    READBACK_DIGITS,
    "setTowerTripTimer",
  );
  assertEqual(tower.firingEnabled, false, "setTowerFiring");
  assertEqual(tower.thermalEnabled, false, "setTowerThermal");

  // ---- The selection, the hover and the held preview ----------------------
  h.debug.setSelected(towerId);
  assertEqual(h.snapshot().selected, towerId, "setSelected");
  h.debug.setHoverShop("lance");
  assertEqual(h.snapshot().hoverShop, "lance", "setHoverShop");

  h.debug.setArmed("bloom");
  h.debug.setPreview(PREVIEW_COL, PREVIEW_ROW);
  h.debug.setPreviewRotation(PREVIEW_ROTATION);
  const build = h.snapshot().build;
  assertNotNull(build, "build, after setArmed");
  if (build !== null) {
    assertEqual(build.type, "bloom", "setArmed");
    assertEqual(build.col, PREVIEW_COL, "setPreview: col");
    assertEqual(build.row, PREVIEW_ROW, "setPreview: row");
    assertEqual(build.rotation, PREVIEW_ROTATION, "setPreviewRotation");
  }

  // ---- One unit ----------------------------------------------------------
  h.debug.addUnit("mote", "left");
  const surge = h.snapshot().surge;
  assertEqual(surge.length, 1, "the units addUnit left on the floor");
  const unitId = surge[surge.length - 1].id;

  const at = tileCenter(quietSite(8).col, quietSite(8).row);
  h.debug.setUnitPosition(unitId, at.x, at.y);
  h.debug.setUnitMaxHp(unitId, MAX_HP);
  h.debug.setUnitHp(unitId, HP);
  h.debug.setUnitSlow(unitId, SLOW_FACTOR);
  h.debug.setUnitSlowTimer(unitId, SLOW_TIMER);
  h.debug.setUnitMotion(unitId, false);

  const unit = readUnit(h.snapshot(), unitId, "the posed unit");
  assertCloseTo(unit.x, at.x, READBACK_DIGITS, "setUnitPosition: x");
  assertCloseTo(unit.y, at.y, READBACK_DIGITS, "setUnitPosition: y");
  assertCloseTo(unit.hp, HP, READBACK_DIGITS, "setUnitHp");
  assertCloseTo(unit.maxHp, MAX_HP, READBACK_DIGITS, "setUnitMaxHp");
  assertCloseTo(unit.slowFactor, SLOW_FACTOR, READBACK_DIGITS, "setUnitSlow");
  assertCloseTo(
    unit.slowTimer,
    SLOW_TIMER,
    READBACK_DIGITS,
    "setUnitSlowTimer",
  );
  assertEqual(unit.motion, false, "setUnitMotion");

  // ---- The pointer, read with no frame between ---------------------------
  h.debug.pointerMove(PRESS_X, PRESS_Y);
  const moved = h.snapshot().pointer;
  assertEqual(moved.x, PRESS_X, "pointerMove: x");
  assertEqual(moved.y, PRESS_Y, "pointerMove: y");

  h.debug.pointerDown(PRESS_X, PRESS_Y);
  const pressed = h.snapshot().pointer;
  assertEqual(pressed.x, PRESS_X, "pointerDown: x");
  assertEqual(pressed.y, PRESS_Y, "pointerDown: y");
  assertEqual(pressed.down, true, "pointerDown: down");

  h.debug.pointerUp();
  assertEqual(h.snapshot().pointer.down, false, "pointerUp: down");

  // ---- What no pose on this surface reaches ------------------------------
  assertEqual(
    h.snapshot().muted,
    mutedAtTheStart,
    "muted, which no operation of this surface sets",
  );

  // The evidence: the floor every pose above built, drawn. The screen goes back
  // to `playing` first, because the run's own screen was posed to `howto` up
  // there and a picture of the how-to page shows a reviewer nothing.
  h.debug.setScreen("playing");
  await h.advance(1);
  captureStill(h, "posed");
});
