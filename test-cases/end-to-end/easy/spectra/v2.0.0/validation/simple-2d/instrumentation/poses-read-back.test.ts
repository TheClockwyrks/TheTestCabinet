// instrumentation/poses-read-back — every pose the surface carries is reported
// back by the snapshot.
//
// specs/instrumentation.md fixes the property outright: "Every field an operation
// can set is present, so every operation is verifiable by setting a value and
// reading it back." This point is that sentence, run over every pose the
// specification names.
//
// A POSE IS DRIVEN AND READ WITH NO FRAME BETWEEN. A pose is a transition — "A
// caller drives a pose through the engine's `apply` ... and a reading against the
// engine's current state" — so the value is on the state the moment the pose
// returns, and reading it there is the check. Running a frame first would let the
// game's own rules move what was just posed (a timer counts down, a band clock
// advances, a bullet flies) and read the game rather than the pose.
//
// EVERY VALUE POSED HERE IS A DISTINGUISHING ONE. Each is different from what the
// state opens on, from what `startPosed` leaves, and from every other value in
// the same reading, so a build that reports a constant, reports its neighbour's
// field, or ignores the argument reads as a different number rather than as a
// coincidence.
//
// EVERY BOOLEAN IS POSED BOTH WAYS, AND THAT IS NOT PEDANTRY. `startPosed` shuts
// all four world gates and `poseDrone` leaves all three of a drone's faculties
// off, so a pose to `false` names a value the world ALREADY holds and is answered
// identically by a build whose setter works and a build whose setter does nothing.
// Only the pose that CHANGES the world decides anything, and each of these seven
// facts has to be shown to move in both directions — so each is posed on, read
// back, posed off, and read back again. The two readings are taken with no frame
// between them and the second before the still, so the game's own rules cannot
// move what the pose just wrote.
//
// MUTE IS NOT IN THE LIST, AND THAT IS THE SPECIFICATION'S DOING: "There is
// therefore no operation that sets muting: `mute` is reached the way a player
// reaches it, through its binding in `specs/controls.md`, and the snapshot
// reports the result." `audio/mute-silences` is where that binding is graded.
//
// WHAT THIS DOES NOT DECIDE. What any posed figure MEANS in play — that a lockout
// blocks a shot, that an inversion swaps a band — which belongs to the group that
// grades the rule. This point asks only that the surface poses what it claims to.

import { afterEach, beforeEach, it } from "vitest";
import { START_LIVES, fluxHold } from "../constants";
import { assertCloseTo, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  bulletOf,
  droneOf,
  lastBullet,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";

/**
 * How closely a posed number must be reported back.
 *
 * Half a millionth of a unit: a pose stores the value it was handed, so the two
 * agree exactly on a conforming build and this tolerance covers nothing but a
 * round trip through a float. Every figure below is far larger than it — the
 * closest pair posed is the ship's lockout (`0.17`) against its cooldown
 * (`0.09`) — so no build can pass by rounding one into another.
 */
const EXACT_DIGITS = 6;

/** The screen and the phase posed, both different from what `startPosed` leaves
 * (`inWave` and `live`) and from each other's defaults. */
const SCREEN = "gameOver" as const;
const PHASE = "ready" as const;

/**
 * The run's figures, each a value nothing else here reports and each inside the
 * range its own rule allows it.
 *
 * `specs/progression.md` starts a run at `START_LIVES` (`3`) and pays exactly one
 * extra life, so four is the most a run ever carries and is what is posed.
 */
const PHASE_TIMER = 0.42;
const MENU_INDEX = 1;
const SCORE = 13570;
const LIVES = START_LIVES + 1;
const STAGE = 4;
const CHALLENGE_HITS = 17;
const RESONANCE = 37;
const INVERSION = 2.75;
const DIVE_CLOCK = 1.25;

/**
 * The figure `setDiveGap` poses, in seconds.
 *
 * Inside `[DIVE_GAP_MIN, DIVE_GAP_MAX]` (`[1.4, 2.6]`) at `diveGapScale(1)`, so it
 * is a gap the wave could itself have drawn (specs/swarm.md).
 */
const DIVE_GAP = 1.75;

/** The ship, posed away from the centre of its lane and off its opening band.
 * `517` is inside `[SHIP_X_MIN, SHIP_X_MAX]` (`[40, 1240]`), so the lane's clamp
 * has nothing to do here (specs/field.md). */
const SHIP_X = 517;
const SHIP_BAND = "magenta" as const;
const LOCKOUT = 0.17;
const COOLDOWN = 0.09;

/** The drone: placed at one point, slotted at another, so a build that reports
 * the slot as the position — or the position as the slot — reads as the wrong
 * pair rather than as a match. */
const DRONE_X = 811;
const DRONE_Y = 233;
const SLOT_X = 466;
const SLOT_Y = 188;

/**
 * The band clock posed on the Flux, in seconds.
 *
 * `0.5` is inside the argument's domain, `0` to `fluxWindow(stage)`
 * (specs/instrumentation.md), and below `fluxHold(4)` (`1.45`), so the Flux is
 * holding its stored band rather than shimmering: `setDroneBandClock` "moves the
 * clock and nothing else", and the band read back beside it is the one
 * `setDroneBand` posed.
 */
const BAND_CLOCK = 0.5;

/** The velocity posed onto a bullet, in logical units per second: neither
 * component is any speed the specification fixes, and the two differ, so a build
 * that reports a default or swaps the pair reads as different numbers. */
const BULLET_VX = 111;
const BULLET_VY = -222;

/** Where the three drones and the bullet stand while they are posed. Geometry
 * only, all well inside the play field (specs/field.md). */
const FLUX_X = 380;
const PRISM_X = 900;
const KIND_Y = 300;
const BULLET_X = 640;
const BULLET_Y = 420;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports every posed value back through snapshot", async () => {
  // An empty, quiet, live wave, so every value read below is one this check
  // posed rather than one the game produced.
  startPosed(h);

  // The drone the per-drone poses are made against, and the two other kinds the
  // stored band is posed on — `band` is the stored field on every kind
  // (specs/instrumentation.md), so all three are read back.
  const shard = poseDrone(h, "shard", DRONE_X, DRONE_Y);
  const flux = poseDrone(h, "flux", FLUX_X, KIND_Y);
  const prism = poseDrone(h, "prism", PRISM_X, KIND_Y);

  h.debug.addPlayerBullet(BULLET_X, BULLET_Y, "cyan");
  const bulletId = lastBullet(h.snapshot()).id;

  // The run.
  h.debug.setScore(SCORE);
  h.debug.setLives(LIVES);
  h.debug.setStage(STAGE);
  h.debug.setExtraLifeAwarded(true);
  h.debug.setChallengeHits(CHALLENGE_HITS);
  h.debug.setMenuIndex(MENU_INDEX);
  h.debug.setPhaseTimer(PHASE_TIMER);
  h.debug.setScreen(SCREEN);
  h.debug.setPhase(PHASE);

  // The band systems.
  h.debug.setResonance(RESONANCE);
  h.debug.setInversion(INVERSION);

  // The ship and its cannon.
  h.debug.setShipX(SHIP_X);
  h.debug.setShipBand(SHIP_BAND);
  h.debug.setFireLockout(LOCKOUT);
  h.debug.setFireCooldown(COOLDOWN);

  // The world gates and the dive clock. Each gate ON, which is the direction that
  // moves it: `startPosed` shut all four. The other direction follows below.
  h.debug.setWaveEntry(true);
  h.debug.setDiveLaunching(true);
  h.debug.setStageClearing(true);
  h.debug.setShipContact(true);
  h.debug.setDiveClock(DIVE_CLOCK);
  h.debug.setDiveGap(DIVE_GAP);

  // The drones.
  h.debug.setDronePosition(shard, DRONE_X, DRONE_Y);
  h.debug.setDroneSlot(shard, SLOT_X, SLOT_Y);
  h.debug.setDroneBand(shard, "magenta");
  h.debug.setDroneBand(flux, "magenta");
  h.debug.setDroneBand(prism, "magenta");
  h.debug.setDronePhase(shard, "returning");
  h.debug.setDroneBandClock(flux, BAND_CLOCK);
  h.debug.setDroneShell(prism, false);
  // Each faculty ON, the direction that moves it: `poseDrone` left all three off.
  h.debug.setDroneTravel(shard, true);
  h.debug.setDroneOscillation(shard, true);
  h.debug.setDroneFire(shard, true);

  // The bullets.
  h.debug.setBulletVelocity(bulletId, BULLET_VX, BULLET_VY);

  // The reading every assertion below is made against: taken before any frame
  // runs, so nothing between the pose and the read could have moved it.
  const s = h.snapshot();

  // ---- And each boolean the other way, before any frame runs ---------------
  //
  // The seven facts above were all posed to the value that CHANGED the world;
  // posed back, each has to change it again. No frame runs between the two
  // readings, so nothing but the poses themselves can be what moved.
  h.debug.setWaveEntry(false);
  h.debug.setDiveLaunching(false);
  h.debug.setStageClearing(false);
  h.debug.setShipContact(false);
  h.debug.setDroneTravel(shard, false);
  h.debug.setDroneOscillation(shard, false);
  h.debug.setDroneFire(shard, false);
  const back = h.snapshot();

  // The picture, drawn afterwards: the still is evidence, never a verdict, so
  // the field is put back on screen for the one frame that paints it and
  // nothing read above is touched.
  h.debug.setScreen("inWave");
  h.debug.setPhase("live");
  await h.advance(1);
  captureStill(h, "posed");

  // The screen and the run.
  assertEqual(s.screen, SCREEN, "setScreen");
  assertEqual(s.phase, PHASE, "setPhase");
  assertCloseTo(s.phaseTimer, PHASE_TIMER, EXACT_DIGITS, "setPhaseTimer");
  assertEqual(s.menuIndex, MENU_INDEX, "setMenuIndex");
  assertEqual(s.score, SCORE, "setScore");
  assertEqual(s.lives, LIVES, "setLives");
  assertEqual(s.stage, STAGE, "setStage");
  assertEqual(s.extraLifeAwarded, true, "setExtraLifeAwarded");
  assertEqual(s.challengeHits, CHALLENGE_HITS, "setChallengeHits");

  // The band systems.
  assertCloseTo(s.resonance, RESONANCE, EXACT_DIGITS, "setResonance");
  assertCloseTo(s.inversion, INVERSION, EXACT_DIGITS, "setInversion");

  // The ship and its cannon.
  assertCloseTo(s.ship.x, SHIP_X, EXACT_DIGITS, "setShipX");
  assertEqual(s.ship.band, SHIP_BAND, "setShipBand");
  assertCloseTo(s.ship.lockout, LOCKOUT, EXACT_DIGITS, "setFireLockout");
  assertCloseTo(s.ship.cooldown, COOLDOWN, EXACT_DIGITS, "setFireCooldown");

  // The world gates and the dive clock.
  assertEqual(s.waveEntry, true, "setWaveEntry(true)");
  assertEqual(s.diveLaunching, true, "setDiveLaunching(true)");
  assertEqual(s.stageClearing, true, "setStageClearing(true)");
  assertEqual(
    s.ship.contact,
    true,
    "setShipContact(true), reported as ship.contact",
  );
  assertCloseTo(s.diveClock, DIVE_CLOCK, EXACT_DIGITS, "setDiveClock");
  assertCloseTo(s.diveGap, DIVE_GAP, EXACT_DIGITS, "setDiveGap");

  // The drones.
  const posed = droneOf(s, shard);
  assertCloseTo(posed.x, DRONE_X, EXACT_DIGITS, "setDronePosition x");
  assertCloseTo(posed.y, DRONE_Y, EXACT_DIGITS, "setDronePosition y");
  assertCloseTo(posed.slotX, SLOT_X, EXACT_DIGITS, "setDroneSlot x");
  assertCloseTo(posed.slotY, SLOT_Y, EXACT_DIGITS, "setDroneSlot y");
  assertEqual(posed.band, "magenta", "setDroneBand on a Shard");
  assertEqual(droneOf(s, flux).band, "magenta", "setDroneBand on a Flux");
  assertEqual(droneOf(s, prism).band, "magenta", "setDroneBand on a Prism");
  assertEqual(posed.phase, "returning", "setDronePhase");
  assertCloseTo(
    droneOf(s, flux).bandClock,
    BAND_CLOCK,
    EXACT_DIGITS,
    `setDroneBandClock, below fluxHold(${String(STAGE)}) ` +
      `(${String(fluxHold(STAGE))}) so the Flux is holding its band`,
  );
  assertEqual(droneOf(s, prism).shellAlive, false, "setDroneShell");
  assertEqual(posed.travel, true, "setDroneTravel(true)");
  assertEqual(posed.oscillation, true, "setDroneOscillation(true)");
  assertEqual(posed.fire, true, "setDroneFire(true)");

  // The seven booleans, posed back.
  const restored = droneOf(back, shard);
  assertEqual(back.waveEntry, false, "setWaveEntry(false)");
  assertEqual(back.diveLaunching, false, "setDiveLaunching(false)");
  assertEqual(back.stageClearing, false, "setStageClearing(false)");
  assertEqual(
    back.ship.contact,
    false,
    "setShipContact(false), reported as ship.contact",
  );
  assertEqual(restored.travel, false, "setDroneTravel(false)");
  assertEqual(restored.oscillation, false, "setDroneOscillation(false)");
  assertEqual(restored.fire, false, "setDroneFire(false)");

  // The bullets.
  assertCloseTo(
    bulletOf(s, bulletId).vx,
    BULLET_VX,
    EXACT_DIGITS,
    "setBulletVelocity vx",
  );
  assertCloseTo(
    bulletOf(s, bulletId).vy,
    BULLET_VY,
    EXACT_DIGITS,
    "setBulletVelocity vy",
  );
});
