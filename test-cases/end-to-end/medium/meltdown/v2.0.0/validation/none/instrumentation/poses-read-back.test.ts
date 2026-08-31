// Meltdown — instrumentation/poses-read-back: every pose the surface offers is
// reported by `snapshot`, so a posed scenario can be verified before it is
// measured.
//
// WHY THIS IS A POINT. `specs/instrumentation.md` says the snapshot carries every
// field an operation can set, "so every operation is verifiable by setting a
// value and reading it back". That round trip is what every other group in this
// suite stands on: a check poses a heat of 60 and then asserts what one second of
// cooling did to it, and if the pose never landed the check is measuring
// something it did not arrange. A pose that silently does nothing, or that lands
// on a field the snapshot does not report, is caught here and nowhere else.
//
// WHAT IS ASSERTED. That the value POSED comes back. Not what the game does with
// it afterwards, and not that a rule fired: `setLives` triggers no game over,
// `setScore` pays no bonus, `setScreen` runs no entry effect — each of those is a
// point of its own. Every value below is read back on the same frame it was
// posed, before anything has had a chance to run.
//
// EVERY POSED VALUE IS DISTINGUISHING. No two fields carry the same number and
// none of them carries a default, so a build that reports one field where another
// was posed, or that reports a constant, reads as the wrong number rather than
// coincidentally right. The screen is not `title`, the mode is not
// `containment`, the difficulty is not `medium`, the speed is not `1`.
//
// MUTE IS NOT ON THE LIST. There is no `setMuted`: muting is a player preference
// the runtime owns, reached through its binding or the panel's control, and the
// snapshot merely reports the bit (`specs/instrumentation.md`). `audio/*` and
// `controls/*` decide it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertDeepEqual,
  assertEqual,
} from "../assert";
import { tileCX, tileCY, TRIP_TIME } from "../constants";
import { freeSite } from "../fixtures";
import {
  captureStill,
  createHarness,
  poseTower,
  poseWalker,
  requireTower,
  requireUnit,
  startRun,
  type Harness,
} from "../harness";

/**
 * How close a posed float must read back, in decimal places for
 * {@link assertCloseTo}: within `5e-7`.
 *
 * A pose is a write and a read of one number, so the only difference a
 * conformant build can introduce is the float's own representation. This is not
 * a tolerance on behaviour; nothing here runs a rule.
 */
const EXACT = 6;

/** Distinguishing values: no two the same, and not one of them a default. */
const POSED = {
  menuIndex: 3,
  money: 4137,
  lives: 13,
  score: 6821,
  wave: 7,
  buildTimer: 9.25,
  wavePending: 21,
  towerHeat: 63.5,
  towerLevel: 3,
  towerTripTimer: 2.75,
  unitHp: 137,
  unitMaxHp: 486,
  unitSlow: 0.42,
  unitSlowTimer: 1.125,
} as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the screen, the run and the world gate as they were posed", async () => {
  await startRun(h);

  await h.debug.setScreen("paused");
  await h.debug.setPhase("wave");
  await h.debug.setMenuIndex(POSED.menuIndex);
  await h.debug.setMode("deeppockets");
  await h.debug.setDifficulty("hard");
  await h.debug.setMoney(POSED.money);
  await h.debug.setLives(POSED.lives);
  await h.debug.setScore(POSED.score);
  await h.debug.setWave(POSED.wave);
  await h.debug.setBuildTimer(POSED.buildTimer);
  await h.debug.setWavePending(POSED.wavePending);
  await h.debug.setSpeed(2);
  await h.debug.setWaveSpawning(true);

  const s = await h.snapshot();
  assertEqual(s.screen, "paused", "setScreen");
  assertEqual(s.phase, "wave", "setPhase");
  assertEqual(s.menuIndex, POSED.menuIndex, "setMenuIndex");
  assertEqual(s.mode, "deeppockets", "setMode");
  assertEqual(s.difficulty, "hard", "setDifficulty");
  assertEqual(s.money, POSED.money, "setMoney");
  assertEqual(s.lives, POSED.lives, "setLives");
  assertEqual(s.score, POSED.score, "setScore");
  assertEqual(s.wave, POSED.wave, "setWave");
  assertCloseTo(s.buildTimer, POSED.buildTimer, EXACT, "setBuildTimer");
  assertEqual(s.wavePending, POSED.wavePending, "setWavePending");
  assertEqual(s.speed, 2, "setSpeed");
  assertEqual(s.waveSpawning, true, "setWaveSpawning(true)");

  // And the gate reads back the other way too, which is the direction every other
  // group's `startRun` depends on.
  await h.debug.setWaveSpawning(false);
  assertEqual(
    (await h.snapshot()).waveSpawning,
    false,
    "setWaveSpawning(false)",
  );
});

it("reports the selection, the shop hover and the held preview as they were posed", async () => {
  await startRun(h);
  const site = freeSite(0);
  const id = await poseTower(h, "arc", site.col, site.row);

  await h.debug.setSelected(id);
  await h.debug.setHoverShop("lance");
  await h.debug.setArmed("bloom");
  const preview = freeSite(1);
  await h.debug.setPreview(preview.col, preview.row);
  await h.debug.setPreviewRotation(3);

  const s = await h.snapshot();
  assertEqual(s.selected, id, "setSelected");
  assertEqual(s.hoverShop, "lance", "setHoverShop");
  assertEqual(s.build?.type, "bloom", "setArmed");
  assertEqual(s.build?.col, preview.col, "setPreview's column");
  assertEqual(s.build?.row, preview.row, "setPreview's row");
  assertEqual(s.build?.rotation, 3, "setPreviewRotation");

  // And each of the three clears the way the specification says it does.
  await h.debug.setSelected(null);
  await h.debug.setHoverShop(null);
  await h.debug.setArmed(null);
  const cleared = await h.snapshot();
  assertEqual(cleared.selected, null, "setSelected(null)");
  assertEqual(cleared.hoverShop, null, "setHoverShop(null)");
  assertEqual(cleared.build, null, "setArmed(null) clears the preview");
});

it("reports a tower's posed heat, level, freshness, trip and faculty gates", async () => {
  await startRun(h);
  const site = freeSite(0);
  const id = await poseTower(h, "lance", site.col, site.row);

  await h.debug.setTowerHeat(id, POSED.towerHeat);
  await h.debug.setTowerLevel(id, POSED.towerLevel);
  await h.debug.setTowerFresh(id, false);
  await h.debug.setTowerTripped(id, true);
  await h.debug.setTowerTripTimer(id, POSED.towerTripTimer);
  await h.debug.setTowerFiring(id, false);
  await h.debug.setTowerThermal(id, false);

  const posed = requireTower(await h.snapshot(), id, "the posed Lance");
  assertCloseTo(posed.heat, POSED.towerHeat, EXACT, "setTowerHeat");
  assertEqual(posed.level, POSED.towerLevel, "setTowerLevel");
  assertEqual(posed.fresh, false, "setTowerFresh(false)");
  assertEqual(posed.tripped, true, "setTowerTripped(true)");
  assertCloseTo(
    posed.tripTimer,
    POSED.towerTripTimer,
    EXACT,
    "setTowerTripTimer",
  );
  assertEqual(posed.firingEnabled, false, "setTowerFiring(false)");
  assertEqual(posed.thermalEnabled, false, "setTowerThermal(false)");

  // And each of the five booleans reads back the other way, so none of them is a
  // field reported as a constant.
  await h.debug.setTowerFresh(id, true);
  await h.debug.setTowerTripped(id, false);
  await h.debug.setTowerTripTimer(id, TRIP_TIME);
  await h.debug.setTowerFiring(id, true);
  await h.debug.setTowerThermal(id, true);
  const back = requireTower(await h.snapshot(), id, "the posed Lance");
  assertEqual(back.fresh, true, "setTowerFresh(true)");
  assertEqual(back.tripped, false, "setTowerTripped(false)");
  assertCloseTo(back.tripTimer, TRIP_TIME, EXACT, "setTowerTripTimer again");
  assertEqual(back.firingEnabled, true, "setTowerFiring(true)");
  assertEqual(back.thermalEnabled, true, "setTowerThermal(true)");
});

it("reports a unit's posed position, hp, slow and motion gate", async () => {
  await startRun(h);
  const id = await poseWalker(h, "hulk", "left");
  const at = freeSite(2);

  await h.debug.setUnitPosition(id, tileCX(at.col), tileCY(at.row));
  await h.debug.setUnitMaxHp(id, POSED.unitMaxHp);
  await h.debug.setUnitHp(id, POSED.unitHp);
  await h.debug.setUnitSlow(id, POSED.unitSlow);
  await h.debug.setUnitSlowTimer(id, POSED.unitSlowTimer);
  await h.debug.setUnitMotion(id, false);

  const posed = requireUnit(await h.snapshot(), id, "the posed Hulk");
  assertCloseTo(posed.x, tileCX(at.col), EXACT, "setUnitPosition's x");
  assertCloseTo(posed.y, tileCY(at.row), EXACT, "setUnitPosition's y");
  assertEqual(posed.col, at.col, "the tile the posed centre falls in");
  assertEqual(posed.row, at.row, "the tile the posed centre falls in");
  assertCloseTo(posed.hp, POSED.unitHp, EXACT, "setUnitHp");
  assertCloseTo(posed.maxHp, POSED.unitMaxHp, EXACT, "setUnitMaxHp");
  assertCloseTo(posed.slowFactor, POSED.unitSlow, EXACT, "setUnitSlow");
  assertCloseTo(
    posed.slowTimer,
    POSED.unitSlowTimer,
    EXACT,
    "setUnitSlowTimer",
  );
  assertEqual(posed.motion, false, "setUnitMotion(false)");

  // The slow reads back off, and the motion gate reads back on.
  await h.debug.setUnitSlow(id, 0);
  await h.debug.setUnitSlowTimer(id, 0);
  await h.debug.setUnitMotion(id, true);
  const back = requireUnit(await h.snapshot(), id, "the posed Hulk");
  assertEqual(back.slowFactor, 0, "setUnitSlow(0)");
  assertEqual(back.slowTimer, 0, "setUnitSlowTimer(0)");
  assertEqual(back.motion, true, "setUnitMotion(true)");
});

it("reports the pointer's posed position and press state", async () => {
  await startRun(h);
  const at = freeSite(3);
  const point = { x: tileCX(at.col), y: tileCY(at.row) };

  await h.debug.pointerMove(point.x, point.y);
  await h.advance(1);
  const moved = (await h.snapshot()).pointer;
  assertCloseTo(moved.x, point.x, EXACT, "pointerMove's x");
  assertCloseTo(moved.y, point.y, EXACT, "pointerMove's y");
  assertEqual(moved.down, false, "the pointer is not pressed after a move");

  await h.debug.pointerDown(point.x, point.y);
  await h.advance(1);
  // The floor the whole of this point posed, at the moment the press is held.
  await captureStill(h, "posed");
  const pressed = (await h.snapshot()).pointer;
  assertCloseTo(pressed.x, point.x, EXACT, "pointerDown's x");
  assertCloseTo(pressed.y, point.y, EXACT, "pointerDown's y");
  assertEqual(pressed.down, true, "pointerDown");

  await h.debug.pointerUp();
  await h.advance(1);
  const released = (await h.snapshot()).pointer;
  assertEqual(released.down, false, "pointerUp");
  // Released at the last reported position, so the position is unchanged.
  assertDeepEqual(
    { x: released.x, y: released.y },
    { x: point.x, y: point.y },
    "pointerUp releases where the pointer stood",
  );
});
