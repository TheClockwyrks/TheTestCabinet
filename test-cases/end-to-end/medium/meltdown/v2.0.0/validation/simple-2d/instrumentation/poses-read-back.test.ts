// Meltdown — instrumentation/poses-read-back: every pose is reported by the
// snapshot.
//
// specs/instrumentation.md, Snapshot shape: "Every field an operation can set is
// present, so every operation is verifiable by setting a value and reading it
// back." That is this point, and it is the one that makes every other check in
// this suite meaningful: a scenario is posed through these operations, so a pose
// that does not take is a scenario that was never arranged.
//
// EVERY VALUE IS POSED AWAY FROM THE ONE THE ARRANGEMENT ALREADY HELD. `startRun`
// opens on the `playing` screen in the `building` phase of Wave 1, at Containment
// Medium, at speed `1`, with the world gate off, nothing selected, nothing
// hovered and nothing armed; every value below moves off that, so a build that
// silently ignores an operation reads the value it opened with rather than the
// one it was handed. A tower is posed at level `2` rather than level `1`, at heat
// `63` rather than `0`, not fresh rather than fresh, and with both faculties held
// rather than on — the four values `addTower` does NOT start it at
// (specs/instrumentation.md, The towers).
//
// THE FIGURES ARE MUTUALLY UNMISTAKABLE, so a build that crosses two poses is
// caught rather than passing on a coincidence: `4321` money, `46` lives, `90210`
// score, Wave `13`, `7.25` seconds on the build timer, `9` pending, menu row `1`.
// No one of them is another's value, and none is a figure the specification
// derives for this run.
//
// THE POINTER IS PRESSED BEFORE ANYTHING IS ARMED, because specs/controls.md has
// a press "only carry the preview": a press reported while a preview is held
// moves that preview to the pressed point, and the preview's own pose would then
// be the one that did not take.
//
// THE WHOLE READING IS TAKEN FROM THE POSE ITSELF, before any frame runs.
// `snapshot` is a pure read of the state (specs/instrumentation.md), so a pose is
// readable the moment it is made — and three of these fields would not survive a
// frame: `pointer` is "refreshed in every update" from the runtime's own idle
// pointer, the posed trip timer counts down, and a tower posed at heat runs its
// thermal model. Reading at the pose is what makes this a check of the OPERATION
// rather than of what a frame did to its result.
//
// MUTE IS NOT IN THE LIST, and its absence is asserted rather than assumed:
// specs/instrumentation.md gives muting to the runtime — "There is therefore no
// operation that sets muting" — so a build that adds a `setMuted` has added an
// operation the case does not specify and the snapshot's `muted` is then no
// longer the runtime's bit.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertUndefined } from "../assert";
import { tileCentre } from "../geometry";
import {
  captureStill,
  createHarness,
  poseTower,
  poseWalker,
  startRun,
  towerOf,
  unitOf,
  type Harness,
} from "../harness";
import { GUN } from "./scenes";

/** The run figures posed, each unmistakable for any other (see the head). */
const RUN = {
  menuIndex: 1,
  money: 4321,
  lives: 46,
  score: 90210,
  wave: 13,
  buildTimer: 7.25,
  wavePending: 9,
  speed: 2,
} as const;

/** The tower figures posed, each off the value `addTower` starts a tower at. */
const TOWER = {
  heat: 63,
  level: 2,
  tripTimer: 3.5,
} as const;

/** The unit figures posed, each off the value `addUnit` releases a unit at. */
const UNIT = {
  tile: { col: 33, row: 25 },
  maxHp: 1234,
  hp: 777,
  slowFactor: 0.4,
  slowTimer: 1.25,
} as const;

/** Where the held preview is put, and the rotation it is held at. */
const PREVIEW = { col: 30, row: 12, rotation: 3 } as const;

/** The floor tile the pointer is pressed on. */
const PRESS = { col: 40, row: 30 } as const;

/**
 * How close a posed number must read back, as decimal places.
 *
 * Six places is `5e-7`. A pose is an assignment rather than an integration:
 * nothing between the call and the read may change the value at all, so the only
 * slack a conforming build can need is the representation of the literal itself.
 */
const READBACK_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports back every value posed on the run, the tower, the unit and the pointer", async () => {
  startRun(h);
  const gun = poseTower(h, "arc", GUN.col, GUN.row);
  const walker = poseWalker(h, "mote", "left");

  // The press first, then the preview it must not have moved.
  const pressAt = tileCentre(PRESS.col, PRESS.row);
  h.debug.pointerDown(pressAt.x, pressAt.y);

  h.debug.setArmed("bloom");
  h.debug.setPreview(PREVIEW.col, PREVIEW.row);
  h.debug.setPreviewRotation(PREVIEW.rotation);
  h.debug.setHoverShop("lance");
  h.debug.setSelected(gun);

  h.debug.setScreen("gameover");
  h.debug.setPhase("wave");
  h.debug.setMenuIndex(RUN.menuIndex);
  h.debug.setMode("bottleneck");
  h.debug.setDifficulty("hard");
  h.debug.setMoney(RUN.money);
  h.debug.setLives(RUN.lives);
  h.debug.setScore(RUN.score);
  h.debug.setWave(RUN.wave);
  h.debug.setBuildTimer(RUN.buildTimer);
  h.debug.setWavePending(RUN.wavePending);
  h.debug.setSpeed(RUN.speed);
  h.debug.setWaveSpawning(true);

  h.debug.setTowerHeat(gun, TOWER.heat);
  h.debug.setTowerLevel(gun, TOWER.level);
  h.debug.setTowerFresh(gun, false);
  h.debug.setTowerTripped(gun, true);
  h.debug.setTowerTripTimer(gun, TOWER.tripTimer);
  h.debug.setTowerFiring(gun, false);
  h.debug.setTowerThermal(gun, false);

  const standing = tileCentre(UNIT.tile.col, UNIT.tile.row);
  h.debug.setUnitPosition(walker, standing.x, standing.y);
  h.debug.setUnitMaxHp(walker, UNIT.maxHp);
  h.debug.setUnitHp(walker, UNIT.hp);
  h.debug.setUnitSlow(walker, UNIT.slowFactor);
  h.debug.setUnitSlowTimer(walker, UNIT.slowTimer);
  h.debug.setUnitMotion(walker, false);

  const s = h.snapshot();

  // The screen and the run.
  assertEqual(s.screen, "gameover", "setScreen");
  assertEqual(s.phase, "wave", "setPhase");
  assertEqual(s.menuIndex, RUN.menuIndex, "setMenuIndex");
  assertEqual(s.mode, "bottleneck", "setMode");
  assertEqual(s.difficulty, "hard", "setDifficulty");
  assertEqual(s.money, RUN.money, "setMoney");
  assertEqual(s.lives, RUN.lives, "setLives");
  assertEqual(s.score, RUN.score, "setScore");
  assertEqual(s.wave, RUN.wave, "setWave");
  assertCloseTo(s.buildTimer, RUN.buildTimer, READBACK_DIGITS, "setBuildTimer");
  assertEqual(s.wavePending, RUN.wavePending, "setWavePending");
  assertEqual(s.speed, RUN.speed, "setSpeed");

  // The world gate.
  assertEqual(s.waveSpawning, true, "setWaveSpawning");

  // The selection, the hover, and the held preview.
  assertEqual(s.selected, gun, "setSelected");
  assertEqual(s.hoverShop, "lance", "setHoverShop");
  assertEqual(s.build?.type, "bloom", "setArmed");
  assertEqual(s.build?.col, PREVIEW.col, "setPreview: the footprint's column");
  assertEqual(s.build?.row, PREVIEW.row, "setPreview: the footprint's row");
  assertEqual(s.build?.rotation, PREVIEW.rotation, "setPreviewRotation");

  // The tower.
  const tower = towerOf(s, gun);
  assertCloseTo(tower.heat, TOWER.heat, READBACK_DIGITS, "setTowerHeat");
  assertEqual(tower.level, TOWER.level, "setTowerLevel");
  assertEqual(tower.fresh, false, "setTowerFresh");
  assertEqual(tower.tripped, true, "setTowerTripped");
  assertCloseTo(
    tower.tripTimer,
    TOWER.tripTimer,
    READBACK_DIGITS,
    "setTowerTripTimer",
  );
  assertEqual(tower.firingEnabled, false, "setTowerFiring");
  assertEqual(tower.thermalEnabled, false, "setTowerThermal");

  // The unit. Its centre is what `setUnitPosition` takes and what the snapshot
  // reports (specs/instrumentation.md, The operations).
  const unit = unitOf(s, walker);
  assertCloseTo(unit.x, standing.x, READBACK_DIGITS, "setUnitPosition: x");
  assertCloseTo(unit.y, standing.y, READBACK_DIGITS, "setUnitPosition: y");
  assertCloseTo(unit.hp, UNIT.hp, READBACK_DIGITS, "setUnitHp");
  assertCloseTo(unit.maxHp, UNIT.maxHp, READBACK_DIGITS, "setUnitMaxHp");
  assertCloseTo(
    unit.slowFactor,
    UNIT.slowFactor,
    READBACK_DIGITS,
    "setUnitSlow",
  );
  assertCloseTo(
    unit.slowTimer,
    UNIT.slowTimer,
    READBACK_DIGITS,
    "setUnitSlowTimer",
  );
  assertEqual(unit.motion, false, "setUnitMotion");

  // The pointer's own position and press state.
  assertCloseTo(s.pointer.x, pressAt.x, READBACK_DIGITS, "pointerDown: x");
  assertCloseTo(s.pointer.y, pressAt.y, READBACK_DIGITS, "pointerDown: y");
  assertEqual(s.pointer.down, true, "pointerDown: the press state");

  await h.advance(1);
  captureStill(h, "posed");
});

it("carries no operation that sets muting", () => {
  const api = h.engine.debug as unknown as Record<string, unknown>;
  assertUndefined(
    api.setMuted,
    "specs/instrumentation.md gives muting to the runtime: there is no setMuted",
  );
});

it("reports back the move and the release the pointer was posed through", () => {
  // On the `playing` screen with nothing armed and nothing under the pointer, a
  // release resolves to a deselection and nothing else (specs/controls.md), so
  // what is left to read is the pointer itself. The move is posed to a second
  // tile, so a build that reports only the press's position is caught.
  startRun(h);
  const from = tileCentre(PRESS.col, PRESS.row);
  const to = tileCentre(PRESS.col + 3, PRESS.row - 2);

  h.debug.pointerDown(from.x, from.y);
  h.debug.pointerMove(to.x, to.y);
  const moved = h.snapshot();
  assertCloseTo(moved.pointer.x, to.x, READBACK_DIGITS, "pointerMove: x");
  assertCloseTo(moved.pointer.y, to.y, READBACK_DIGITS, "pointerMove: y");
  assertEqual(
    moved.pointer.down,
    true,
    "pointerMove leaves the press where it was",
  );

  h.debug.pointerUp();
  const released = h.snapshot();
  assertEqual(released.pointer.down, false, "pointerUp: the press state");
  assertCloseTo(
    released.pointer.x,
    to.x,
    READBACK_DIGITS,
    "pointerUp releases at the last reported position: x",
  );
  assertCloseTo(
    released.pointer.y,
    to.y,
    READBACK_DIGITS,
    "pointerUp releases at the last reported position: y",
  );
});
