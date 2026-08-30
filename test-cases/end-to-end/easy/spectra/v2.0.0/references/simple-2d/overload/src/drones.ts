// Spectra — how a drone moves and when it fires (`specs/swarm.md`,
// `specs/drones.md`).
//
// Every drone is in exactly one of four phases, and its whole motion is a function
// of that phase, its own clock and the field around it. Nothing here holds a
// heading or a waypoint of its own: a path is integrated from a direction the
// declared fields decide, so a frame's motion is the same however the frame was
// divided into sub-steps.
//
//   * `entering`  A drone holds its starting point until its group is released,
//                 then pursues its slot along a curve that straightens as it goes.
//                 On a challenge stage it sweeps across the field instead and is
//                 removed at the far edge.
//   * `formation` It sits at its slot plus the sway the whole block carries.
//   * `diving`    It descends at the dive speed, bending toward the ship's current
//                 x, and either wraps once through the bottom or turns for home at
//                 the turn line. A Prism heads home at the inversion line, swapping
//                 the field's bands as it crosses.
//   * `returning` It pursues its slot again and settles back into formation.
//
// A drone's three faculty gates are read here and nowhere else: `travel` gates the
// motion alone, `oscillation` a Flux's band clock alone, and `fire` the shots a
// dive carries alone.

import {
  CUES,
  DIVE_FIRE_Y,
  DIVE_GAP_MAX,
  DIVE_GAP_MIN,
  DIVE_SPEED,
  ENTER_GROUP_GAP,
  ENTER_SPEED,
  FIELD_BOTTOM,
  FIELD_LEFT,
  FIELD_RIGHT,
  FIELD_TOP,
  INVERSION_TIME,
  OVERLOAD_DIVE_SCALE,
  PRISM_INVERT_Y,
  diveGapScale,
  droneSpeedScale,
  fluxWindow,
  isChallengeStage,
  swayOffset,
} from "./constants";
import { droneHalf, opposite, shimmering } from "./bands";
import { addEnemyBullet, PRISM_MUZZLE_SPREAD, muzzleY } from "./bullets";
import {
  drawInt,
  drawRange,
  type FrameEvents,
  type MutDrone,
  type Sim,
} from "./sim";

/**
 * The entry group a drone carries when it arrived through the debug surface
 * rather than with a wave.
 *
 * `specs/swarm.md` counts an entry group from `0`, so a drone that arrived with no
 * wave has none. Two rules read it: such a drone is released the moment it is
 * added rather than on the wave's own schedule, and the stage-clear rule counts
 * the wave's own drones alone, so destroying a drone a scenario placed never
 * clears a stage.
 */
export const NO_GROUP = -1;

/**
 * The shot count a Shard carries through its Overload plunge.
 *
 * `specs/mode.md` gives an overloaded Shard a dive at `OVERLOAD_DIVE_SCALE` times
 * the ordinary dive speed, and `specs/state.md` declares no field to hold that
 * apart from an ordinary dive. A plunge is a dive that has already spent every
 * shot its kind takes, which is what this count says and what makes the plunge
 * silent; it returns to `0` with the phase, so a later launch of the same drone is
 * an ordinary dive.
 */
const PLUNGE_SHOTS = 9;

/** Whether the drone came in with the stage's own wave. */
export function ofWave(drone: MutDrone): boolean {
  return drone.entryGroup >= 0;
}

/** How far the swirl bends an entrance at its start, and how fast it decays. */
const ENTER_SWIRL = 0.85;
const ENTER_SWIRL_DECAY = 0.9;

/** How hard a dive bends toward the ship, and over what horizontal gap. */
const DIVE_HOME_GAIN = 0.7;
const DIVE_HOME_RANGE = 200;

/** How wide a dive weaves, and how long one weave takes. */
const DIVE_WEAVE_GAIN = 0.25;
const DIVE_WEAVE_PERIOD = 1.6;

/** How long a wrapping dive runs before it turns for home. */
const DIVE_RUN_TIME = 2.8;

/** The depth a looping dive turns back at, above the bottom HUD strip. */
const DIVE_TURN_Y = 640;

/** How far a challenge sweep weaves, and over what period. */
const CHALLENGE_WEAVE = 0.5;
const CHALLENGE_WEAVE_PERIOD = 4;

/** How far past the field's edge a challenge sweep runs before it is removed. */
const CHALLENGE_EXIT = 40;

/** How far inside the field's edges a dive is held. */
const DIVE_EDGE_MARGIN = 12;

/** Whether the drone is in an Overload plunge rather than an ordinary dive. */
export function plunging(drone: MutDrone): boolean {
  return drone.kind === "shard" && drone.shotsFired >= PLUNGE_SHOTS;
}

/** Put the drone into its Overload plunge, which is a dive it fires nothing in. */
export function enterPlunge(drone: MutDrone): void {
  enterPhase(drone, "diving");
  drone.shotsFired = PLUNGE_SHOTS;
}

/** Move the drone into a phase, restarting the clock the phase runs on. */
export function enterPhase(drone: MutDrone, phase: MutDrone["phase"]): void {
  drone.phase = phase;
  drone.phaseClock = 0;
  drone.shotsFired = 0;
}

/** Put the drone on an attack run. */
export function enterDive(drone: MutDrone): void {
  enterPhase(drone, "diving");
}

/** End the drone's run and send it home, ending any plunge with it. */
export function enterReturn(drone: MutDrone): void {
  enterPhase(drone, "returning");
}

/** The seconds of game time before the drone's own group is released. */
function releaseDelay(drone: MutDrone): number {
  return Math.max(0, drone.entryGroup) * ENTER_GROUP_GAP;
}

/**
 * Whether the drone's group has been released.
 *
 * The wave's entry clock advances only while `waveEntry` is on, so a clock that
 * has passed the group's delay is a released group even after the gate is turned
 * off, and a drone already travelling its entrance flies it as usual. The
 * comparison is strict so that a gate that was never on releases nothing, the
 * first group's delay being zero.
 */
function released(sim: Sim, drone: MutDrone): boolean {
  // A drone the surface added arrives the moment it is added, whatever the wave's
  // own release is doing.
  if (!ofWave(drone)) return true;
  return sim.entryClock > releaseDelay(drone);
}

/** How many shots the drone's kind takes over one dive. */
export function shotsPerDive(drone: MutDrone): number {
  return drone.kind === "prism" ? 2 : 1;
}

/** Move `pos` a step of `speed * h` toward `(tx, ty)`, reporting arrival. */
function pursue(
  drone: MutDrone,
  tx: number,
  ty: number,
  speed: number,
  h: number,
  swirl: number,
): boolean {
  const dx = tx - drone.x;
  const dy = ty - drone.y;
  const distance = Math.hypot(dx, dy);
  const step = speed * h;
  if (distance <= step || distance === 0) {
    drone.x = tx;
    drone.y = ty;
    return true;
  }
  const ux = dx / distance;
  const uy = dy / distance;
  // The heading is the bearing to the target rotated by the swirl, so the path
  // is a curve that straightens as the swirl decays.
  const hx = ux - swirl * uy;
  const hy = uy + swirl * ux;
  const length = Math.hypot(hx, hy);
  drone.x += (hx / length) * step;
  drone.y += (hy / length) * step;
  return false;
}

/** The x the drone's slot sits at right now, sway included. */
export function slotNowX(sim: Sim, drone: MutDrone): number {
  return drone.slotX + swayOffset(sim.swayClock);
}

/** Which way a drone's entrance curves, so a wave's two halves sweep apart. */
function swirlSign(drone: MutDrone): number {
  return drone.slotX < (FIELD_LEFT + FIELD_RIGHT) / 2 ? -1 : 1;
}

/** One entering drone's step, on a standard stage. */
function stepEntrance(sim: Sim, drone: MutDrone, h: number): void {
  if (!released(sim, drone)) return;
  const delay = releaseDelay(drone);
  const speed = ENTER_SPEED * droneSpeedScale(sim.stage);
  const travelled = Math.max(0, drone.phaseClock - delay);
  const swirl =
    ENTER_SWIRL * Math.exp(-travelled / ENTER_SWIRL_DECAY) * swirlSign(drone);
  const arrived = pursue(
    drone,
    slotNowX(sim, drone),
    drone.slotY,
    speed,
    h,
    swirl,
  );
  if (arrived) enterPhase(drone, "formation");
}

/** One entering drone's step, on a challenge stage: a sweep across and out. */
function stepChallengeSweep(sim: Sim, drone: MutDrone, h: number): void {
  if (!released(sim, drone)) return;
  const delay = releaseDelay(drone);
  const side = drone.entryGroup % 2 === 0 ? 1 : -1;
  const travelled = Math.max(0, drone.phaseClock - delay);
  const dy =
    CHALLENGE_WEAVE *
    Math.sin((2 * Math.PI * travelled) / CHALLENGE_WEAVE_PERIOD);
  const length = Math.hypot(1, dy);
  // A challenge stage runs at the stage-1 figures whatever stage it falls on.
  const step = ENTER_SPEED * h;
  drone.x += (side / length) * step;
  drone.y += (dy / length) * step;
}

/** One diving drone's step, and the two ways a dive ends. */
function stepDive(sim: Sim, drone: MutDrone, h: number, ev: FrameEvents): void {
  const plunge = plunging(drone);
  const speed =
    DIVE_SPEED *
    droneSpeedScale(sim.stage) *
    (plunge ? OVERLOAD_DIVE_SCALE : 1);
  const home = Math.max(
    -1,
    Math.min(1, (sim.ship.x - drone.x) / DIVE_HOME_RANGE),
  );
  // A plunge is headlong: it takes the homing bend and none of the weave.
  const weave = plunge
    ? 0
    : DIVE_WEAVE_GAIN *
      Math.sin((2 * Math.PI * drone.phaseClock) / DIVE_WEAVE_PERIOD);
  const lateral = DIVE_HOME_GAIN * home + weave;
  const length = Math.hypot(lateral, 1);
  const step = speed * h;
  const from = drone.y;
  drone.x += (lateral / length) * step;
  drone.y += step / length;
  drone.x = Math.max(
    FIELD_LEFT + DIVE_EDGE_MARGIN,
    Math.min(FIELD_RIGHT - DIVE_EDGE_MARGIN, drone.x),
  );

  // A Prism that carries a layer past the inversion line swaps the whole field's
  // bands and heads home unharmed.
  if (drone.kind === "prism") {
    if (from < PRISM_INVERT_Y && drone.y >= PRISM_INVERT_Y) {
      sim.inversion = INVERSION_TIME;
      ev.cues.add(CUES.inversion);
      enterReturn(drone);
      return;
    }
    if (drone.phaseClock >= DIVE_RUN_TIME) enterReturn(drone);
    return;
  }

  // Half the drones carry their dive through the bottom and re-appear above the
  // field; the rest turn for home at the turn line.
  if (drone.id % 2 === 0) {
    if (drone.y > FIELD_BOTTOM) drone.y -= FIELD_BOTTOM - FIELD_TOP;
    if (drone.phaseClock >= DIVE_RUN_TIME) enterReturn(drone);
    return;
  }
  if (drone.y >= DIVE_TURN_Y) enterReturn(drone);
}

/** One returning drone's step. */
function stepReturn(sim: Sim, drone: MutDrone, h: number): void {
  const speed = DIVE_SPEED * droneSpeedScale(sim.stage);
  const arrived = pursue(drone, slotNowX(sim, drone), drone.slotY, speed, h, 0);
  if (arrived) enterPhase(drone, "formation");
}

/** Run a Flux's band clock on, flipping its stored band at each window's end. */
function stepBandClock(sim: Sim, drone: MutDrone, h: number): void {
  if (drone.kind !== "flux" || !drone.oscillation) return;
  const window = fluxWindow(sim.stage);
  drone.bandClock += h;
  while (drone.bandClock >= window) {
    drone.bandClock -= window;
    drone.band = opposite(drone.band);
  }
}

/** The shots a diving drone takes as it crosses the fire line. */
function stepFire(sim: Sim, drone: MutDrone): void {
  if (drone.phase !== "diving" || !drone.fire) return;
  // No drone fires on a challenge stage, and no enemy bullet appears in one.
  if (isChallengeStage(sim.stage)) return;
  if (drone.shotsFired >= shotsPerDive(drone)) return;
  if (drone.y < DIVE_FIRE_Y) return;
  // A Flux fires nothing while it shimmers, and takes its shot as soon as it
  // settles on a band.
  if (shimmering(drone, sim.stage)) return;

  const y = muzzleY(drone.y, droneHalf(drone));
  if (drone.kind === "prism") {
    // A Prism fires both bands together, so it threatens the ship whichever band
    // the ship is tuned to.
    addEnemyBullet(sim, drone.x - PRISM_MUZZLE_SPREAD, y, drone.band);
    addEnemyBullet(sim, drone.x + PRISM_MUZZLE_SPREAD, y, opposite(drone.band));
    drone.shotsFired += 2;
    return;
  }
  addEnemyBullet(sim, drone.x, y, drone.band);
  drone.shotsFired += 1;
}

/** Advance every drone by `h`, in the phase each is in. */
export function advanceDrones(sim: Sim, h: number, ev: FrameEvents): void {
  const challenge = isChallengeStage(sim.stage);
  for (const drone of sim.drones) {
    drone.phaseClock += h;
    stepBandClock(sim, drone, h);

    if (drone.travel) {
      switch (drone.phase) {
        case "entering":
          if (challenge) stepChallengeSweep(sim, drone, h);
          else stepEntrance(sim, drone, h);
          break;
        case "formation":
          drone.x = slotNowX(sim, drone);
          drone.y = drone.slotY;
          break;
        case "diving":
          stepDive(sim, drone, h, ev);
          break;
        case "returning":
          stepReturn(sim, drone, h);
          break;
      }
    }

    stepFire(sim, drone);
  }

  // A challenge drone that has swept off the far edge has left the field.
  if (!challenge) return;
  const left = sim.drones.filter(
    (drone) =>
      drone.x < FIELD_LEFT - CHALLENGE_EXIT ||
      drone.x > FIELD_RIGHT + CHALLENGE_EXIT,
  );
  if (left.length === 0) return;
  ev.waveDronesRemoved += left.filter(ofWave).length;
  sim.drones = sim.drones.filter((drone) => !left.includes(drone));
}

/** Run the wave's own release of entry groups. */
export function advanceEntry(sim: Sim, h: number): void {
  if (sim.waveEntry) sim.entryClock += h;
}

/** Run the assault's own choice of which formation drone dives next, and when. */
export function launchDives(sim: Sim, h: number): void {
  if (!sim.diveLaunching) return;
  sim.diveClock += h;
  if (sim.diveClock < sim.diveTarget) return;
  const resting = sim.drones.filter((drone) => drone.phase === "formation");
  if (resting.length === 0) return;
  const pick = resting[drawInt(sim, 0, resting.length - 1)];
  if (pick !== undefined) enterDive(pick);
  sim.diveClock = 0;
  sim.diveTarget =
    drawRange(sim, DIVE_GAP_MIN, DIVE_GAP_MAX) * diveGapScale(sim.stage);
}
