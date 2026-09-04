// instrumentation/poses-read-back — every pose the surface carries is reported by
// `snapshot`, so each one is verifiable by setting a value and reading it back.
//
// specs/instrumentation.md states the rule the whole surface is built to, under
// Snapshot shape: "Every field an operation can set is present, so every operation
// is verifiable by setting a value and reading it back." That is what makes the
// rest of this suite mean anything — a scenario is only posed if the poses landed
// — so this point walks the operations one at a time and reads each one's own
// field.
//
// EVERY POSE IS READ WITH NO FRAME BETWEEN IT AND THE READING. Under this engine a
// pose acts on the live game at the moment of the call and a reading is built at
// the call (specs/instrumentation.md), and the harness advances a frame only when
// a check asks it to. That matters here: a frame would run the phase timer, the
// fire lockout, the fire cooldown, the inversion and a Flux's band clock down, and
// the check would be reading the tick rather than the pose.
//
// EVERY BOOLEAN IS POSED BOTH WAYS. A field read back once could be a constant.
// The extra-life latch, the three world gates, a Prism's shell and each of a
// drone's three faculties are set to one value, read, set to the other, and read
// again, so a snapshot that simply always answers `true` fails on the second
// reading.
//
// AND EVERY SCALAR IS POSED AWAY FROM WHAT `startPosed` LEFT. The screen is
// `inWave` there, the phase `live`, the stage `1`, the score `0`, the meter `0`,
// the ship on cyan at `640` with no lockout and no cooldown — so a build that
// ignores a pose reads back the value it already held rather than the one asked
// for, and the failure names the operation.
//
// THE STORED BAND IS POSED ON ALL THREE KINDS, and that is deliberate:
// `setDroneBand` "Sets the drone's stored band, on every kind. For a Prism it is
// the shell's band… For a Flux it is the band the drone is holding". A build that
// wrote the band only on a Shard would pass a check that posed one drone.
//
// MUTE IS DELIBERATELY ABSENT. There is no `setMuted` under any engine — "There is
// therefore no operation that sets muting: `mute` is reached the way a player
// reaches it" (specs/instrumentation.md) — so nothing here can set it and read it
// back. `controls.mute-m` drives the real binding and `audio.mute-silences` reads
// the consequence. The two clock operations are absent for a different reason:
// `setAutoStep` and `advance` belong to the engineless build alone, since the
// engine owns the clock here.
//
// WHAT THIS DOES NOT DECIDE. What any posed value MEANS to the simulation. That a
// gate held off keeps a wave's drones away is `instrumentation.wave-entry-gate`'s,
// that a posed score grants no life is
// `instrumentation.set-score-grants-no-life`'s, and that the four stage-scaled
// figures follow `setStage` is `instrumentation.set-stage-derives`'s — so every
// value posed here is one nothing else in the frame would have moved anyway, and
// the ship's `x` is well inside the lane's clamp.

import { afterEach, beforeEach, it } from "vitest";
import { START_LIVES, fluxHold } from "../constants";
import { assertEqual } from "../assert";
import {
  bulletById,
  captureStill,
  createHarness,
  droneById,
  poseDrone,
  posePlayerBullet,
  startPosed,
  type Harness,
  type SpectraSnapshot,
} from "../harness";

/**
 * The values posed into the scalar fields.
 *
 * Not one of them is the value `startPosed` left behind, so a build that ignores
 * a pose reads back what it already held and the failure names the operation.
 * `STAGE` is `7`, which specs/stages.md makes a standard stage rather than a
 * challenge one, so nothing about the stage's own rules is in play here.
 */
const SCREEN = "stageCleared" as const;
const PHASE = "ready" as const;
const PHASE_TIMER = 0.75;
const MENU_INDEX = 2;
const SCORE = 4321;
const LIVES = START_LIVES + 2;
const STAGE = 7;
const RESONANCE = 42;
const INVERSION = 3.5;
const SHIP_X = 417;
const SHIP_BAND = "magenta" as const;
const LOCKOUT = 0.22;
const COOLDOWN = 0.09;
const DIVE_CLOCK = 1.25;

/** Where the three posed drones stand, and where the posed bullet hangs. */
const SHARD_AT = { x: 300, y: 300 } as const;
const FLUX_AT = { x: 500, y: 300 } as const;
const PRISM_AT = { x: 700, y: 300 } as const;
const BULLET_AT = { x: 150, y: 620 } as const;

/** The values posed into a drone's own fields. */
const DRONE_AT = { x: 721, y: 233 } as const;
const DRONE_BAND = "magenta" as const;
const DRONE_PHASE = "diving" as const;
const DRONE_SLOT = { x: 555, y: 175 } as const;

/**
 * How far a Flux is posed into its band window, in seconds.
 *
 * `0.9`, which is below `fluxHold(7)` (`1.3` s by specs/stages.md's formula), so
 * the Flux is holding its stored band rather than shimmering and the reading is of
 * the clock alone. `setDroneBandClock` "moves the clock and nothing else", so the
 * band it was posed with is read back beside it.
 */
const BAND_CLOCK = 0.9;

/** The velocity posed onto a bullet, in logical units per second. */
const BULLET_VX = 33;
const BULLET_VY = -44;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports every posed field back through snapshot", async () => {
  startPosed(h);

  // The field the poses below are applied to: one drone of each kind and one
  // bullet. Every faculty is off, so nothing moves of its own accord.
  const shard = poseDrone(h, "shard", SHARD_AT.x, SHARD_AT.y);
  const flux = poseDrone(h, "flux", FLUX_AT.x, FLUX_AT.y);
  const prism = poseDrone(h, "prism", PRISM_AT.x, PRISM_AT.y);
  const bullet = posePlayerBullet(h, BULLET_AT.x, BULLET_AT.y, "cyan");

  await h.advance(1);
  // Taken before the walk below, so a failing pose still leaves the picture of
  // the field it was applied to.
  captureStill(h, "posed");

  /** Apply one pose and read its own field straight back off the snapshot. */
  const readsBack = <T>(
    pose: () => void,
    read: (s: SpectraSnapshot) => T,
    want: T,
    what: string,
  ): void => {
    pose();
    assertEqual(read(h.snapshot()), want, what);
  };

  // ---- The screen and the run ---------------------------------------------

  readsBack(
    () => h.debug.setScreen(SCREEN),
    (s) => s.screen,
    SCREEN,
    `snapshot().screen after setScreen(${JSON.stringify(SCREEN)})`,
  );
  readsBack(
    () => h.debug.setPhaseTimer(PHASE_TIMER),
    (s) => s.phaseTimer,
    PHASE_TIMER,
    `snapshot().phaseTimer, in seconds, after setPhaseTimer(${PHASE_TIMER})`,
  );
  readsBack(
    () => h.debug.setMenuIndex(MENU_INDEX),
    (s) => s.menuIndex,
    MENU_INDEX,
    `snapshot().menuIndex after setMenuIndex(${MENU_INDEX})`,
  );
  readsBack(
    () => h.debug.setScore(SCORE),
    (s) => s.score,
    SCORE,
    `snapshot().score after setScore(${SCORE})`,
  );
  readsBack(
    () => h.debug.setLives(LIVES),
    (s) => s.lives,
    LIVES,
    `snapshot().lives after setLives(${LIVES})`,
  );
  readsBack(
    () => h.debug.setStage(STAGE),
    (s) => s.stage,
    STAGE,
    `snapshot().stage after setStage(${STAGE})`,
  );
  for (const awarded of [true, false]) {
    readsBack(
      () => h.debug.setExtraLifeAwarded(awarded),
      (s) => s.extraLifeAwarded,
      awarded,
      `snapshot().extraLifeAwarded after setExtraLifeAwarded(${awarded})`,
    );
  }

  // ---- Resonance and the inversion ----------------------------------------

  readsBack(
    () => h.debug.setResonance(RESONANCE),
    (s) => s.resonance,
    RESONANCE,
    `snapshot().resonance after setResonance(${RESONANCE})`,
  );
  readsBack(
    () => h.debug.setInversion(INVERSION),
    (s) => s.inversion,
    INVERSION,
    `snapshot().inversion, in SECONDS remaining, after ` +
      `setInversion(${INVERSION})`,
  );

  // ---- The ship and its cannon --------------------------------------------

  readsBack(
    () => h.debug.setShipX(SHIP_X),
    (s) => s.ship.x,
    SHIP_X,
    `snapshot().ship.x after setShipX(${SHIP_X}), which is well inside ` +
      `[SHIP_X_MIN, SHIP_X_MAX] so the lane's clamp has nothing to do`,
  );
  readsBack(
    () => h.debug.setShipBand(SHIP_BAND),
    (s) => s.ship.band,
    SHIP_BAND,
    `snapshot().ship.band after setShipBand(${JSON.stringify(SHIP_BAND)})`,
  );
  readsBack(
    () => h.debug.setFireLockout(LOCKOUT),
    (s) => s.ship.lockout,
    LOCKOUT,
    `snapshot().ship.lockout, in seconds, after setFireLockout(${LOCKOUT})`,
  );
  readsBack(
    () => h.debug.setFireCooldown(COOLDOWN),
    (s) => s.ship.cooldown,
    COOLDOWN,
    `snapshot().ship.cooldown, in seconds, after setFireCooldown(${COOLDOWN})`,
  );

  // ---- The three world gates, each posed both ways, and the dive clock -----

  for (const enabled of [true, false]) {
    readsBack(
      () => h.debug.setWaveEntry(enabled),
      (s) => s.waveEntry,
      enabled,
      `snapshot().waveEntry after setWaveEntry(${enabled})`,
    );
    readsBack(
      () => h.debug.setDiveLaunching(enabled),
      (s) => s.diveLaunching,
      enabled,
      `snapshot().diveLaunching after setDiveLaunching(${enabled})`,
    );
    readsBack(
      () => h.debug.setShipContact(enabled),
      (s) => s.ship.contact,
      enabled,
      `snapshot().ship.contact after setShipContact(${enabled})`,
    );
  }
  readsBack(
    () => h.debug.setDiveClock(DIVE_CLOCK),
    (s) => s.diveClock,
    DIVE_CLOCK,
    `snapshot().diveClock, in seconds since the last launch, after ` +
      `setDiveClock(${DIVE_CLOCK})`,
  );

  // ---- The drones ----------------------------------------------------------

  h.debug.setDronePosition(shard, DRONE_AT.x, DRONE_AT.y);
  const placed = droneById(h.snapshot(), shard);
  assertEqual(
    `${placed?.x},${placed?.y}`,
    `${DRONE_AT.x},${DRONE_AT.y}`,
    `the centre snapshot() reports for drone ${shard} after ` +
      `setDronePosition(${shard}, ${DRONE_AT.x}, ${DRONE_AT.y})`,
  );

  // The stored band on every kind: a Shard's own, a Flux's held band, and a
  // Prism's SHELL band (specs/instrumentation.md, The drones).
  for (const [id, kind] of [
    [shard, "Shard"],
    [flux, "Flux"],
    [prism, "Prism"],
  ] as const) {
    readsBack(
      () => h.debug.setDroneBand(id, DRONE_BAND),
      (s) => droneById(s, id)?.band,
      DRONE_BAND,
      `snapshot() ${kind} ${id}'s stored band after ` +
        `setDroneBand(${id}, ${JSON.stringify(DRONE_BAND)})`,
    );
  }

  readsBack(
    () => h.debug.setDroneBandClock(flux, BAND_CLOCK),
    (s) => droneById(s, flux)?.bandClock,
    BAND_CLOCK,
    `snapshot() Flux ${flux}'s bandClock, in seconds into its current window, ` +
      `after setDroneBandClock(${flux}, ${BAND_CLOCK}) — which is below ` +
      `fluxHold(${STAGE}) (${fluxHold(STAGE)} s), so the Flux is holding its ` +
      `band rather than shimmering (specs/drones.md)`,
  );
  assertEqual(
    droneById(h.snapshot(), flux)?.band,
    DRONE_BAND,
    `snapshot() Flux ${flux}'s stored band after its band clock was posed — ` +
      `setDroneBandClock moves the clock and nothing else ` +
      `(specs/instrumentation.md)`,
  );

  h.debug.setDroneSlot(shard, DRONE_SLOT.x, DRONE_SLOT.y);
  const slotted = droneById(h.snapshot(), shard);
  assertEqual(
    `${slotted?.slotX},${slotted?.slotY}`,
    `${DRONE_SLOT.x},${DRONE_SLOT.y}`,
    `the resting slot snapshot() reports for drone ${shard} after ` +
      `setDroneSlot(${shard}, ${DRONE_SLOT.x}, ${DRONE_SLOT.y})`,
  );

  readsBack(
    () => h.debug.setDronePhase(shard, DRONE_PHASE),
    (s) => droneById(s, shard)?.phase,
    DRONE_PHASE,
    `snapshot() drone ${shard}'s phase after ` +
      `setDronePhase(${shard}, ${JSON.stringify(DRONE_PHASE)})`,
  );

  for (const intact of [false, true]) {
    readsBack(
      () => h.debug.setDroneShell(prism, intact),
      (s) => droneById(s, prism)?.shellAlive,
      intact,
      `snapshot() Prism ${prism}'s shellAlive after ` +
        `setDroneShell(${prism}, ${intact})`,
    );
  }

  for (const enabled of [true, false]) {
    readsBack(
      () => h.debug.setDroneTravel(shard, enabled),
      (s) => droneById(s, shard)?.travel,
      enabled,
      `snapshot() drone ${shard}'s travel after ` +
        `setDroneTravel(${shard}, ${enabled})`,
    );
    readsBack(
      () => h.debug.setDroneOscillation(flux, enabled),
      (s) => droneById(s, flux)?.oscillation,
      enabled,
      `snapshot() Flux ${flux}'s oscillation after ` +
        `setDroneOscillation(${flux}, ${enabled})`,
    );
    readsBack(
      () => h.debug.setDroneFire(shard, enabled),
      (s) => droneById(s, shard)?.fire,
      enabled,
      `snapshot() drone ${shard}'s fire after setDroneFire(${shard}, ${enabled})`,
    );
  }

  // ---- The bullets ---------------------------------------------------------

  h.debug.setBulletVelocity(bullet, BULLET_VX, BULLET_VY);
  const steered = bulletById(h.snapshot(), bullet);
  assertEqual(
    `${steered?.vx},${steered?.vy}`,
    `${BULLET_VX},${BULLET_VY}`,
    `the velocity snapshot() reports for bullet ${bullet}, in logical units ` +
      `per second, after setBulletVelocity(${bullet}, ${BULLET_VX}, ` +
      `${BULLET_VY})`,
  );

  // ---- And the phase, posed last -------------------------------------------
  //
  // `ready` takes the ship off the field for the hold (specs/progression.md), so
  // it is posed after every reading the ship's own fields were taken for.
  readsBack(
    () => h.debug.setPhase(PHASE),
    (s) => s.phase,
    PHASE,
    `snapshot().phase after setPhase(${JSON.stringify(PHASE)})`,
  );
});
