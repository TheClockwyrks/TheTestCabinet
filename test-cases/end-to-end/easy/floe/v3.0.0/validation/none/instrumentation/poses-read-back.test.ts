// Floe — instrumentation/poses-read-back: every pose the surface carries is
// reported by `snapshot`, so each one is verifiable by setting a value and
// reading it back.
//
// `specs/instrumentation.md` states the rule the whole surface is built to:
// "Every field an operation can set is present, so every operation is verifiable
// by setting it and reading it back." That is what makes the rest of this suite
// mean anything — a scenario is only posed if the poses landed — so this point
// walks the operations one at a time and reads each one's own field.
//
// EVERY POSE IS READ WITH NO TICK BETWEEN IT AND THE READING. The harness holds
// the game off the wall clock with `setAutoStep(false)`, so the simulation moves
// only when `advance` says so (`specs/instrumentation.md`, The clock) and nothing
// runs between a pose and the snapshot that checks it. That matters here: a tick
// would run the phase hold, the hop cooldown and the lanes on, and the check
// would be reading the update rather than the pose.
//
// EVERY VALUE IS ONE THE POSE HAD TO CARRY. Each is deliberately not the value
// `startCrossing` left behind — the screen is `playing` there, the phase
// `crossing`, the score `0`, the level `1`, the four gates off — so a build that
// ignores a pose reads back the value it already held rather than the one asked
// for, and the failure names the operation. Each of the seven booleans is posed
// BOTH WAYS for the same reason: a field read back once could be a constant, and
// a snapshot that simply always answers `false` fails on the second reading.
//
// MUTE IS DELIBERATELY ABSENT. There is no `setMuted` under any engine —
// "Muting is reached the same way a player reaches it, through the mute action"
// — so nothing here can set it and read it back; `controls/mute-m` drives the
// real binding. THE AUTO-STEP BIT IS ABSENT FOR A DIFFERENT REASON: `setAutoStep`
// and `advance` pose no game state, so there is no snapshot field for them and
// nothing to read back. `instrumentation/advances-in-real-time`,
// `instrumentation/deterministic-core` and `instrumentation/tick-length` read
// their effect instead.
//
// SETLEVEL IS TAKEN LAST, ON PURPOSE. It "lays the strait out" for the level,
// replacing every vehicle and every floe, so posing it earlier would empty the
// rosters the lane readings below are taken from.
//
// WHAT THIS DOES NOT DECIDE. What any posed value MEANS to the simulation. That a
// posed gate holds a faculty off is each gate item's, that a posed step is
// carried out is `hunter/*`'s, and that a lane at a speed carries its items that
// far is `ice/*`'s and `water/*`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  tileCX,
  tileCY,
  type Facing,
  type Phase,
  type Screen,
} from "../constants";
import {
  captureStill,
  createHarness,
  laneAt,
  poseBear,
  poseLane,
  requireBear,
  requireItem,
  startCrossing,
  type FloeSnapshot,
  type Harness,
} from "../harness";

/** The strait the per-entity poses below are applied to. */
const VEHICLE_ROW = 12;
const VEHICLE_KIND = "car" as const;
const VEHICLE_COL = 8;
const FLOE_ROW = 5;
const FLOE_KIND = "pan" as const;
const FLOE_COL = 20;
const BOARD_BEAR_COL = 25;
const BOARD_BEAR_ROW = 13;
const BOARD_CRITTER_COL = 20;
const BOARD_CRITTER_ROW = 16;

/**
 * The values posed into the scalar fields.
 *
 * Every one is exactly representable as a double, so each reading is an exact
 * comparison rather than one carrying a tolerance the specification never
 * granted: a pose is a pose, and a build that stored the number it was handed
 * reports that number.
 */
const SCREEN: Screen = "howto";
const PHASE: Phase = "dying";
const PHASE_TIMER = 0.75;
const MENU_INDEX = 2;
const SCORE = 4321;
const LIVES = 5;
const REACHED_LEVEL = 6;
const TIMER = 12.5;
const LEVEL = 7;

/** The critter's poses: a tile, then a centre `x` inside a different column. */
const CRITTER_COL = 13;
const CRITTER_ROW = 12;
const CRITTER_X = 951;
const CRITTER_X_COL = 29; // colAt(951) = floor(951 / 32)
const CRITTER_FACING: Facing = "left";
const HOP_COOLDOWN = 0.0625;
const BEST_ROW = 11;

/** The bear's poses: a tile, a committed step, a mid-glide centre, a target. */
const BEAR_COL = 25;
const BEAR_ROW = 13;
const BEAR_STEP: Facing = "left";
const BEAR_STEP_COL = BEAR_COL - 1;
const BEAR_STEP_ROW = BEAR_ROW;
const BEAR_X = 803.5;
const BEAR_Y = 500.25;
const BEAR_TARGET_COL = 33;
const BEAR_TARGET_ROW = 4;

/** The lanes' poses: a left edge each, and a speed and a direction per band. */
const VEHICLE_X = 517.25;
const FLOE_X = 233.75;
const ICE_SPEED = 3.25;
const ICE_DIR = -1; // specs/ice.md runs row 12 rightward, so this is a real pose
const WATER_SPEED = 1.75;
const WATER_DIR = -1; // specs/water.md runs row 5 rightward

/** The bay posed both ways, and the bay the bonus catch is posed into. */
const BAY = 2;
const FISH_BAY = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports every posed field back through snapshot", async () => {
  await startCrossing(h);

  // The strait the poses below are applied to: one vehicle, one floe, one bear
  // and the critter. Both lanes are held at a speed of 0 by `poseLane` and the
  // bear's three faculties are off, so the one tick driven for the picture
  // leaves everything exactly where it was put.
  const [vehicle] = await poseLane(h, VEHICLE_ROW, VEHICLE_KIND, [VEHICLE_COL]);
  const [floe] = await poseLane(h, FLOE_ROW, FLOE_KIND, [FLOE_COL]);
  const bear = await poseBear(h, BOARD_BEAR_COL, BOARD_BEAR_ROW, {
    sense: false,
    routing: false,
    travel: false,
  });
  await h.debug.setCritterTile(BOARD_CRITTER_COL, BOARD_CRITTER_ROW);

  await h.advance(1);
  // Taken before the walk, so a pose that fails to land still leaves the picture
  // of the strait it was applied to.
  await captureStill(h, "read-back");

  /** Apply one pose and read its own field straight back off the snapshot. */
  const readsBack = async <T>(
    pose: () => Promise<void>,
    read: (s: FloeSnapshot) => T,
    want: T,
    what: string,
  ): Promise<void> => {
    await pose();
    assertEqual(read(await h.snapshot()), want, what);
  };

  // ---- The screen and the run ---------------------------------------------

  await readsBack(
    () => h.debug.setScreen(SCREEN),
    (s) => s.screen,
    SCREEN,
    `snapshot().screen after setScreen(${JSON.stringify(SCREEN)})`,
  );
  await readsBack(
    () => h.debug.setPhase(PHASE),
    (s) => s.phase,
    PHASE,
    `snapshot().phase after setPhase(${JSON.stringify(PHASE)})`,
  );
  await readsBack(
    () => h.debug.setPhaseTimer(PHASE_TIMER),
    (s) => s.phaseTimer,
    PHASE_TIMER,
    `snapshot().phaseTimer after setPhaseTimer(${PHASE_TIMER})`,
  );
  await readsBack(
    () => h.debug.setMenuIndex(MENU_INDEX),
    (s) => s.menuIndex,
    MENU_INDEX,
    `snapshot().menuIndex after setMenuIndex(${MENU_INDEX})`,
  );
  await readsBack(
    () => h.debug.setScore(SCORE),
    (s) => s.score,
    SCORE,
    `snapshot().score after setScore(${SCORE})`,
  );
  await readsBack(
    () => h.debug.setLives(LIVES),
    (s) => s.lives,
    LIVES,
    `snapshot().lives after setLives(${LIVES})`,
  );
  await readsBack(
    () => h.debug.setReachedLevel(REACHED_LEVEL),
    (s) => s.reachedLevel,
    REACHED_LEVEL,
    `snapshot().reachedLevel after setReachedLevel(${REACHED_LEVEL})`,
  );
  await readsBack(
    () => h.debug.setTimer(TIMER),
    (s) => s.timer,
    TIMER,
    `snapshot().timer after setTimer(${TIMER})`,
  );

  // ---- The critter ---------------------------------------------------------

  await h.debug.setCritterTile(CRITTER_COL, CRITTER_ROW);
  const onTile = (await h.snapshot()).critter;
  assertEqual(
    `${onTile.col},${onTile.row}`,
    `${CRITTER_COL},${CRITTER_ROW}`,
    `the tile snapshot() reports after setCritterTile(${CRITTER_COL}, ` +
      `${CRITTER_ROW})`,
  );
  assertEqual(
    `${onTile.x},${onTile.y}`,
    `${tileCX(CRITTER_COL)},${tileCY(CRITTER_ROW)}`,
    `the CENTRE snapshot() reports after setCritterTile(${CRITTER_COL}, ` +
      `${CRITTER_ROW}), which puts it on that tile's centre (specs/strait.md)`,
  );

  // The mid-drift pose: the centre `x` alone, with the row left as it stands and
  // the column following by colAt(x).
  await h.debug.setCritterX(CRITTER_X);
  const drifted = (await h.snapshot()).critter;
  assertEqual(
    drifted.x,
    CRITTER_X,
    `snapshot().critter.x after setCritterX(${CRITTER_X})`,
  );
  assertEqual(
    drifted.col,
    CRITTER_X_COL,
    `snapshot().critter.col after setCritterX(${CRITTER_X}), which follows ` +
      `its centre by colAt(x) (specs/instrumentation.md)`,
  );
  assertEqual(
    drifted.row,
    CRITTER_ROW,
    `snapshot().critter.row after setCritterX(${CRITTER_X}), which leaves the ` +
      `row as it stands`,
  );

  await readsBack(
    () => h.debug.setCritterFacing(CRITTER_FACING),
    (s) => s.critter.facing,
    CRITTER_FACING,
    `snapshot().critter.facing after ` +
      `setCritterFacing(${JSON.stringify(CRITTER_FACING)})`,
  );
  await readsBack(
    () => h.debug.setHopCooldown(HOP_COOLDOWN),
    (s) => s.critter.hopCooldown,
    HOP_COOLDOWN,
    `snapshot().critter.hopCooldown, in seconds, after ` +
      `setHopCooldown(${HOP_COOLDOWN})`,
  );
  await readsBack(
    () => h.debug.setBestRow(BEST_ROW),
    (s) => s.critter.bestRow,
    BEST_ROW,
    `snapshot().critter.bestRow after setBestRow(${BEST_ROW})`,
  );

  // ---- The bear ------------------------------------------------------------

  await h.debug.setBearTile(bear, BEAR_COL, BEAR_ROW);
  const settled = requireBear(await h.snapshot(), bear, "setBearTile");
  assertEqual(
    `${settled.col},${settled.row}`,
    `${BEAR_COL},${BEAR_ROW}`,
    `the tile snapshot() reports the bear settled on after ` +
      `setBearTile(${bear}, ${BEAR_COL}, ${BEAR_ROW})`,
  );
  assertEqual(
    `${settled.stepCol},${settled.stepRow}`,
    `${BEAR_COL},${BEAR_ROW}`,
    `the tile it is travelling into after setBearTile(${bear}, ${BEAR_COL}, ` +
      `${BEAR_ROW}) — settling puts it on that tile, so it is no longer ` +
      `between two (specs/instrumentation.md)`,
  );
  assertEqual(
    `${settled.x},${settled.y}`,
    `${tileCX(BEAR_COL)},${tileCY(BEAR_ROW)}`,
    `the CENTRE snapshot() reports after setBearTile(${bear}, ${BEAR_COL}, ` +
      `${BEAR_ROW})`,
  );

  await h.debug.setBearStep(bear, BEAR_STEP);
  const stepping = requireBear(await h.snapshot(), bear, "setBearStep");
  assertEqual(
    `${stepping.stepCol},${stepping.stepRow}`,
    `${BEAR_STEP_COL},${BEAR_STEP_ROW}`,
    `the tile it is travelling into after ` +
      `setBearStep(${bear}, ${JSON.stringify(BEAR_STEP)}) from tile ` +
      `(${BEAR_COL}, ${BEAR_ROW})`,
  );

  // The mid-glide pose: the centre alone, with the two tiles left as they stand.
  await h.debug.setBearPosition(bear, BEAR_X, BEAR_Y);
  const glided = requireBear(await h.snapshot(), bear, "setBearPosition");
  assertEqual(
    `${glided.x},${glided.y}`,
    `${BEAR_X},${BEAR_Y}`,
    `the CENTRE snapshot() reports after setBearPosition(${bear}, ${BEAR_X}, ` +
      `${BEAR_Y})`,
  );

  await readsBack(
    () => h.debug.setBearTarget(bear, BEAR_TARGET_COL, BEAR_TARGET_ROW),
    (s) => {
      const found = requireBear(s, bear, "setBearTarget");
      return `${found.target.col},${found.target.row}`;
    },
    `${BEAR_TARGET_COL},${BEAR_TARGET_ROW}`,
    `the tile snapshot() reports the bear hunting after ` +
      `setBearTarget(${bear}, ${BEAR_TARGET_COL}, ${BEAR_TARGET_ROW})`,
  );

  for (const enabled of [true, false]) {
    await readsBack(
      () => h.debug.setBearSense(bear, enabled),
      (s) => requireBear(s, bear, "setBearSense").sense,
      enabled,
      `snapshot() bear ${bear}'s sense after setBearSense(${bear}, ${enabled})`,
    );
    await readsBack(
      () => h.debug.setBearRouting(bear, enabled),
      (s) => requireBear(s, bear, "setBearRouting").routing,
      enabled,
      `snapshot() bear ${bear}'s routing after ` +
        `setBearRouting(${bear}, ${enabled})`,
    );
    await readsBack(
      () => h.debug.setBearTravel(bear, enabled),
      (s) => requireBear(s, bear, "setBearTravel").travel,
      enabled,
      `snapshot() bear ${bear}'s travel after ` +
        `setBearTravel(${bear}, ${enabled})`,
    );
  }

  // ---- The lanes -----------------------------------------------------------

  await readsBack(
    () => h.debug.setVehicleX(vehicle, VEHICLE_X),
    (s) => requireItem(s, vehicle, "setVehicleX").x,
    VEHICLE_X,
    `the LEFT EDGE snapshot() reports for vehicle ${vehicle} after ` +
      `setVehicleX(${vehicle}, ${VEHICLE_X})`,
  );
  await readsBack(
    () => h.debug.setFloeX(floe, FLOE_X),
    (s) => requireItem(s, floe, "setFloeX").x,
    FLOE_X,
    `the LEFT EDGE snapshot() reports for floe ${floe} after ` +
      `setFloeX(${floe}, ${FLOE_X})`,
  );

  await readsBack(
    () => h.debug.setLaneSpeed(VEHICLE_ROW, ICE_SPEED),
    (s) => laneAt(s, VEHICLE_ROW)?.speed,
    ICE_SPEED,
    `the speed snapshot() reports for the lane on row ${VEHICLE_ROW}, in ` +
      `tiles per second, after setLaneSpeed(${VEHICLE_ROW}, ${ICE_SPEED})`,
  );
  await readsBack(
    () => h.debug.setLaneDirection(VEHICLE_ROW, ICE_DIR),
    (s) => laneAt(s, VEHICLE_ROW)?.dir,
    ICE_DIR,
    `the direction snapshot() reports for the lane on row ${VEHICLE_ROW} ` +
      `after setLaneDirection(${VEHICLE_ROW}, ${ICE_DIR})`,
  );
  await readsBack(
    () => h.debug.setLaneSpeed(FLOE_ROW, WATER_SPEED),
    (s) => laneAt(s, FLOE_ROW)?.speed,
    WATER_SPEED,
    `the speed snapshot() reports for the lane on row ${FLOE_ROW} after ` +
      `setLaneSpeed(${FLOE_ROW}, ${WATER_SPEED})`,
  );
  await readsBack(
    () => h.debug.setLaneDirection(FLOE_ROW, WATER_DIR),
    (s) => laneAt(s, FLOE_ROW)?.dir,
    WATER_DIR,
    `the direction snapshot() reports for the lane on row ${FLOE_ROW} after ` +
      `setLaneDirection(${FLOE_ROW}, ${WATER_DIR})`,
  );

  // ---- The bays and the bonus catch ---------------------------------------

  for (const filled of [true, false]) {
    await readsBack(
      () => h.debug.setBay(BAY, filled),
      (s) => s.bays[BAY],
      filled,
      `snapshot().bays[${BAY}] after setBay(${BAY}, ${filled})`,
    );
  }
  await readsBack(
    () => h.debug.setFishBay(FISH_BAY),
    (s) => s.fishBay,
    FISH_BAY,
    `snapshot().fishBay after setFishBay(${FISH_BAY})`,
  );

  // ---- The four world gates, each posed both ways --------------------------

  for (const enabled of [true, false]) {
    await readsBack(
      () => h.debug.setBearEmergence(enabled),
      (s) => s.bearEmergence,
      enabled,
      `snapshot().bearEmergence after setBearEmergence(${enabled})`,
    );
    await readsBack(
      () => h.debug.setCatchTest(enabled),
      (s) => s.catchTest,
      enabled,
      `snapshot().catchTest after setCatchTest(${enabled})`,
    );
    await readsBack(
      () => h.debug.setFishCadence(enabled),
      (s) => s.fishCadence,
      enabled,
      `snapshot().fishCadence after setFishCadence(${enabled})`,
    );
    await readsBack(
      () => h.debug.setTimerRunning(enabled),
      (s) => s.timerRunning,
      enabled,
      `snapshot().timerRunning after setTimerRunning(${enabled})`,
    );
  }

  // ---- The level, taken last because it re-lays the sixteen lanes ----------

  await readsBack(
    () => h.debug.setLevel(LEVEL),
    (s) => s.level,
    LEVEL,
    `snapshot().level after setLevel(${LEVEL})`,
  );
});
