// Meltdown — instrumentation/overlay-is-read-only: watching the debug overlay
// leaves the game exactly as it is.
//
// THE RULE. `specs/instrumentation.md`, under Diagnostics: the overlay is
// "read-only, never changes gameplay", with "every source a pure read, so
// watching the overlay leaves the game exactly as it is". `specs/controls.md`
// puts the toggle on the backtick key, `Backquote`.
//
// WHY THIS IS `none` ALONE. Under an engine the overlay is the ENGINE's: it owns
// the backtick key, the panel it draws, its hidden-at-start state, and the fact
// that reading it changes nothing. A check on any of those under an engine
// returns the same verdict for every build on that engine and grades the engine
// rather than the build. Under `none` the build writes the overlay itself, so the
// purity of it is the build's own work and is decidable. What the build registers
// into the overlay, and the values those sources report, are every engine's, and
// that is `instrumentation.overlay`.
//
// HOW IT IS READ. The whole snapshot is taken either side of the toggle over a
// floor posed to be motionless — an untimed opening phase, a tower with both
// faculties held, a unit with its locomotion held, the world gate shut — so the
// only field a conformant build may differ in is `simTime`, which gains the one
// frame the press ran on. `muted` is in that comparison on purpose: a build that
// bound the backtick to something of its own is caught by it.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertDeepEqual, assertEqual } from "../assert";
import { TOWER_DEFS, isEmitter, tileCX, tileCY } from "../constants";
import type { TowerType } from "../constants";
import { freeSite, laneTile } from "../fixtures";
import {
  captureStill,
  createHarness,
  poseTower,
  poseWalker,
  seconds,
  startRun,
  toggleOverlay,
  type Harness,
  type MeltdownSnapshot,
} from "../harness";

/** The floor the toggle is read over, posed to distinguishing figures. */
const TOWER: TowerType = "lance";
const POSED_HEAT = 63;
const POSED_LEVEL = 3;
const UNIT = "hulk";
const POSED_HP = 137;
const POSED_MAX_HP = 300;
const POSED_SCORE = 6821;

/** The run's own figures, each one distinctive on a panel full of numbers. */
const POSED_MONEY = 4321;
const POSED_LIVES = 176;
const POSED_WAVE = 13;

/** The tower's figures at level I (`specs/towers.md`); its redline is `92`. */
const TOWER_DEF = TOWER_DEFS[TOWER];
if (!isEmitter(TOWER_DEF)) throw new TypeError(`${TOWER} is not an emitter`);

/** Where the tower stands and where the unit is held. Geometry, not a threshold. */
const TOWER_SITE = freeSite(0);
const UNIT_TILE = laneTile("left", 6);

/**
 * How close `simTime` must come to the one frame the toggle ran, in decimal
 * places: within `5e-7`.
 *
 * Not a behavioural tolerance. The press runs exactly one frame of the harness's
 * clock and `simTime` accumulates the game time it was handed
 * (`specs/instrumentation.md`), so the only difference a conformant build can
 * introduce is the float's own representation.
 */
const TIME_DIGITS = 6;

let h: Harness;

/**
 * Pose a floor that cannot change on its own, carrying values worth reporting.
 *
 * Every faculty that could move a number is held, and each is held for a reason
 * this point can state: the phase is the untimed `opening` one, which "carries no
 * countdown, reports a `buildTimer` of `0`, and never starts a wave on its own"
 * (`specs/waves.md`); the tower's guns and thermal model are both off, so its heat
 * is the one posed here; the unit's locomotion is off, so its tile and its hp are
 * the ones posed here; and `startRun` has already shut the world gate.
 */
async function poseAStillFloor(): Promise<void> {
  await startRun(h);
  await h.debug.setPhase("opening");
  await h.debug.setBuildTimer(0);
  await h.debug.setMoney(POSED_MONEY);
  await h.debug.setLives(POSED_LIVES);
  await h.debug.setWave(POSED_WAVE);
  await h.debug.setScore(POSED_SCORE);

  const tower = await poseTower(h, TOWER, TOWER_SITE.col, TOWER_SITE.row);
  await h.debug.setTowerFiring(tower, false);
  await h.debug.setTowerThermal(tower, false);
  await h.debug.setTowerHeat(tower, POSED_HEAT);
  await h.debug.setTowerLevel(tower, POSED_LEVEL);

  const unit = await poseWalker(h, UNIT, "left");
  await h.debug.setUnitMotion(unit, false);
  await h.debug.setUnitPosition(
    unit,
    tileCX(UNIT_TILE.col),
    tileCY(UNIT_TILE.row),
  );
  await h.debug.setUnitMaxHp(unit, POSED_MAX_HP);
  await h.debug.setUnitHp(unit, POSED_HP);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("changes nothing about the game", async () => {
  await poseAStillFloor();

  await h.advance(1);
  const before: MeltdownSnapshot = await h.snapshot();

  await toggleOverlay(h);
  await captureStill(h, "unmoved");
  const after: MeltdownSnapshot = await h.snapshot();

  // The one field a frame is allowed to move, and by exactly one frame's worth.
  assertCloseTo(
    after.simTime - before.simTime,
    seconds(1),
    TIME_DIGITS,
    "the game time the toggle's own frame added",
  );

  for (const field of [
    "version",
    "screen",
    "phase",
    "menuIndex",
    "mode",
    "difficulty",
    "money",
    "lives",
    "score",
    "wave",
    "waveCount",
    "startMoney",
    "startLives",
    "interest",
    "buildTimer",
    "wavePending",
    "waveRemaining",
    "speed",
    "muted",
    "waveSpawning",
    "autoStep",
    "selected",
    "hoverShop",
  ] as const) {
    assertEqual(
      after[field],
      before[field],
      `${field} across the overlay toggle`,
    );
  }
  for (const field of [
    "nextWave",
    "build",
    "buildZone",
    "pointer",
    "paths",
    "controls",
    "towers",
    "surge",
  ] as const) {
    assertDeepEqual(
      after[field],
      before[field],
      `${field} across the overlay toggle`,
    );
  }
});
