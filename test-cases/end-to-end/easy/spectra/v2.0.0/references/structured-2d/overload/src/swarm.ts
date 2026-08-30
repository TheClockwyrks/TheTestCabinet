// Spectra — how any drone behaves, whatever kind it is (specs/swarm.md).
//
// The four phases and the paths they run are here; what each of the three kinds
// does differently is `src/drones.ts`, and what a wave is made of is
// `src/waves.ts`. Every figure the specification fixes comes from
// `src/constants.ts`; the figures below are the shape of the choreography, which
// the specification leaves to the build.
//
// EVERY PATH IS INTEGRATED FROM THE DECLARED STATE. An entrance and a dive are
// both a heading and a speed, applied as `p += v * h` inside a sub-step, and the
// heading is a function of where the drone is, where it is going, and how long it
// has been in its phase. Nothing lays down a track when a phase begins, which is
// what lets a dive close on the ship as `specs/swarm.md` requires and lets a
// drone the mode adds mid-wave — an overloaded Prism's escort — fly in from
// wherever it was added.
//
// THE THREE PER-DRONE FACULTIES gate one thing each (`specs/instrumentation.md`).
// `travel` gates locomotion alone — the entrance, the ride on the sway, the dive
// and the return — and nothing is cancelled, completed or resolved early when it
// is off; `oscillation` gates a Flux's band clock alone; `fire` gates the shots a
// dive takes alone.

import {
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
  OVERLOAD_DIVE_SCALE,
  PRISM_INVERT_Y,
  diveGapScale,
  droneSpeedScale,
  isChallengeStage,
  swayOffset,
} from "./constants";
import { beginInversion, shimmering } from "./bands";
import { addEnemyBulletTo } from "./bullets";
import {
  advanceOscillation,
  droneHalf,
  droneShots,
  setDronePhase,
} from "./drones";
import { randomPick, randomRange } from "./rng";
import type { FrameCues } from "./audio";
import type { DroneState, SpectraState } from "./game";

// ---- The shape of the choreography (the build's own figures) --------------

/** Straight down, which an entrance is pulled toward before it hooks in. */
const STRAIGHT_DOWN = Math.PI / 2;
/** How far an entrance's heading is pulled toward straight down, in radians. */
const ENTRY_SWERVE = 0.85;
/** How long that pull takes to fade, in seconds. */
const ENTRY_SWERVE_DECAY = 0.8;
/** How near its slot an entering drone has to be to have settled. */
const ARRIVE_EPSILON = 2;

/** The horizontal gap at which a dive's bend toward the ship saturates. */
const DIVE_BEND_RANGE = 260;
/** The steepest a dive's bend tilts it off straight down, in radians. */
const DIVE_MAX_TILT = 0.85;
/** How far a dive swings either side of that heading, in radians. */
const DIVE_SWING = 0.5;
/** How long one of those swings takes, in seconds. */
const DIVE_SWING_PERIOD = 1.1;
/** The steepest total tilt a dive ever flies, so every dive keeps descending. */
const DIVE_MAX_HEADING = 1.35;
/** The line a looping dive turns back above, inside the play field. */
const DIVE_TURN_Y = FIELD_BOTTOM - 40;
/** Where a wrapping dive re-appears, above the play field. */
const WRAP_REENTRY_Y = FIELD_TOP - 20;
/** The longest a dive may run before it heads home, in seconds. */
const DIVE_MAX_TIME = 8;

/** How far outside the field a challenge group's flyover begins and ends. */
export const CHALLENGE_MARGIN = 70;
/** The row the first challenge drone of a group crosses the field on. */
export const CHALLENGE_ROW0 = FIELD_TOP + 70;
/** The gap between the rows of one challenge group. */
export const CHALLENGE_ROW_GAP = 40;
/** How far a challenge drone weaves either side of its row. */
const CHALLENGE_WEAVE = 26;
/** How long one weave takes, in seconds. */
const CHALLENGE_WEAVE_PERIOD = 1.6;

// ---- The figures a stage scales -----------------------------------------

/**
 * How fast a drone travels at the current stage. A challenge stage does not
 * scale: whatever stage it falls on, it runs at the stage-1 figures.
 */
export function travelScale(state: SpectraState): number {
  return isChallengeStage(state.stage) ? 1 : droneSpeedScale(state.stage);
}

/** How fast a drone covers its entrance. */
export function entranceSpeed(state: SpectraState): number {
  return ENTER_SPEED * travelScale(state);
}

/** How fast `drone` covers its dive or its return home. */
export function diveSpeed(state: SpectraState, drone: DroneState): number {
  const scale = drone.plunge ? OVERLOAD_DIVE_SCALE : 1;
  return DIVE_SPEED * travelScale(state) * scale;
}

// ---- The formation ------------------------------------------------------

/** The point `drone`'s resting slot sits at right now, sway included. */
export function slotPoint(
  state: SpectraState,
  drone: DroneState,
): { x: number; y: number } {
  return { x: drone.slotX + swayOffset(state.swayClock), y: drone.slotY };
}

// ---- The entrance -------------------------------------------------------

/** The seconds after the wave opened at which `drone`'s group is released. */
export function releaseTime(drone: DroneState): number {
  return ENTER_GROUP_GAP * drone.entryGroup;
}

/** Whether the wave has released `drone` yet. */
export function released(state: SpectraState, drone: DroneState): boolean {
  return state.entryClock >= releaseTime(drone);
}

/**
 * The heading an entrance flies on, in radians.
 *
 * It points at the slot, pulled toward straight down by a swerve that fades over
 * the first second, so a released group falls into the field and then hooks
 * across to its slots rather than dropping onto them. The pull is bounded, so the
 * drone always closes on its slot and an entrance never orbits.
 */
function entranceHeading(
  drone: DroneState,
  target: { x: number; y: number },
): number {
  const toSlot = Math.atan2(target.y - drone.y, target.x - drone.x);
  const swerve =
    ENTRY_SWERVE * Math.exp(-drone.phaseClock / ENTRY_SWERVE_DECAY);
  const pull = Math.max(-swerve, Math.min(swerve, STRAIGHT_DOWN - toSlot));
  return toSlot + pull;
}

/** Advance one entering drone toward its slot, and settle it when it arrives. */
function advanceEntrance(
  state: SpectraState,
  drone: DroneState,
  h: number,
): void {
  drone.phaseClock += h;
  const target = slotPoint(state, drone);
  const step = entranceSpeed(state) * h;
  const gap = Math.hypot(target.x - drone.x, target.y - drone.y);
  if (gap <= Math.max(step, ARRIVE_EPSILON)) {
    drone.x = target.x;
    drone.y = target.y;
    setDronePhase(drone, "formation");
    return;
  }
  const heading = entranceHeading(drone, target);
  drone.x += Math.cos(heading) * step;
  drone.y += Math.sin(heading) * step;
}

// ---- The challenge flyover ---------------------------------------------

/** Which row of its group a challenge drone crosses the field on. */
function challengeRow(drone: DroneState): number {
  return Math.max(
    0,
    Math.round((drone.slotY - CHALLENGE_ROW0) / CHALLENGE_ROW_GAP),
  );
}

/** Which way a challenge group sweeps: right for an even group, left for an odd. */
export function challengeDirection(drone: DroneState): number {
  return drone.entryGroup % 2 === 0 ? 1 : -1;
}

/** Whether a challenge drone has swept clear of the field and is done. */
function challengeGone(drone: DroneState): boolean {
  return challengeDirection(drone) > 0
    ? drone.x > FIELD_RIGHT + CHALLENGE_MARGIN
    : drone.x < FIELD_LEFT - CHALLENGE_MARGIN;
}

/** Advance one challenge drone across the field, weaving as it goes. */
function advanceFlyover(
  state: SpectraState,
  drone: DroneState,
  h: number,
): void {
  drone.phaseClock += h;
  const row = CHALLENGE_ROW0 + CHALLENGE_ROW_GAP * challengeRow(drone);
  drone.x += challengeDirection(drone) * entranceSpeed(state) * h;
  drone.y =
    row +
    CHALLENGE_WEAVE *
      Math.sin((2 * Math.PI * drone.phaseClock) / CHALLENGE_WEAVE_PERIOD);
}

// ---- The dive ----------------------------------------------------------

/** The heading `drone`'s dive is flying on, in radians off straight down. */
function diveHeading(state: SpectraState, drone: DroneState): number {
  const gap = state.ship.x - drone.x;
  const bend = Math.max(-1, Math.min(1, gap / DIVE_BEND_RANGE)) * DIVE_MAX_TILT;
  const swing =
    DIVE_SWING * Math.sin((2 * Math.PI * drone.phaseClock) / DIVE_SWING_PERIOD);
  return Math.max(-DIVE_MAX_HEADING, Math.min(DIVE_MAX_HEADING, bend + swing));
}

/**
 * Whether `drone`'s dive wraps through the bottom of the field or turns back
 * above it. Both endings are `specs/swarm.md`'s, and a wave flies some of each; a
 * Prism turns back at the line it inverts the field from.
 */
function diveWraps(drone: DroneState): boolean {
  return drone.kind !== "prism" && drone.id % 2 === 1;
}

/** Advance one diving drone, and end its dive where its path is done. */
function advanceDive(
  state: SpectraState,
  drone: DroneState,
  h: number,
  cues: FrameCues,
): void {
  drone.phaseClock += h;
  const speed = diveSpeed(state, drone);
  const heading = diveHeading(state, drone);
  drone.x += Math.sin(heading) * speed * h;
  drone.y += Math.cos(heading) * speed * h;

  if (drone.kind === "prism") {
    // A Prism dives to the line it inverts the field from, which is below every
    // other dive's turn and above the bottom HUD strip: it swaps the whole field's
    // bands rather than being destroyed there, and heads back toward its slot.
    if (drone.y >= PRISM_INVERT_Y) {
      beginInversion(state, cues);
      setDronePhase(drone, "returning");
      return;
    }
  } else if (diveWraps(drone)) {
    if (drone.y > FIELD_BOTTOM) {
      drone.y = WRAP_REENTRY_Y;
      setDronePhase(drone, "returning");
      return;
    }
  } else if (drone.y >= DIVE_TURN_Y) {
    setDronePhase(drone, "returning");
    return;
  }

  if (drone.phaseClock >= DIVE_MAX_TIME) setDronePhase(drone, "returning");
}

/** Advance one returning drone toward its slot, and settle it when it arrives. */
function advanceReturn(
  state: SpectraState,
  drone: DroneState,
  h: number,
): void {
  drone.phaseClock += h;
  const target = slotPoint(state, drone);
  const dx = target.x - drone.x;
  const dy = target.y - drone.y;
  const gap = Math.hypot(dx, dy);
  const step = diveSpeed(state, drone) * h;
  if (gap <= Math.max(step, ARRIVE_EPSILON)) {
    drone.x = target.x;
    drone.y = target.y;
    setDronePhase(drone, "formation");
    return;
  }
  drone.x += (dx / gap) * step;
  drone.y += (dy / gap) * step;
}

// ---- Enemy fire --------------------------------------------------------

/** The point a shot leaves `drone` from. */
function muzzle(drone: DroneState): { x: number; y: number } {
  return { x: drone.x, y: drone.y + droneHalf(drone) + 6 };
}

/**
 * Take the shots `drone`'s dive owes, once it has crossed the fire line.
 *
 * A diver takes its first shot in the frame its centre first crosses
 * `DIVE_FIRE_Y` travelling downward, and a shimmering Flux fires nothing — so a
 * Flux shimmering as it crosses the line takes its shot as soon as it settles on
 * a band, if it is still diving. A Prism fires both of its shots together, one
 * carrying each band. No drone fires on a challenge stage.
 */
function fireDive(state: SpectraState, drone: DroneState): void {
  if (drone.phase !== "diving" || !drone.fire) return;
  if (isChallengeStage(state.stage)) return;
  if (drone.y < DIVE_FIRE_Y) return;
  if (drone.shotsFired >= droneShots(drone)) return;
  if (shimmering(drone, state.stage)) return;

  const at = muzzle(drone);
  if (drone.kind === "prism") {
    addEnemyBulletTo(state, at.x - 8, at.y, "cyan");
    addEnemyBulletTo(state, at.x + 8, at.y, "magenta");
    drone.shotsFired = 2;
    return;
  }
  addEnemyBulletTo(state, at.x, at.y, drone.band);
  drone.shotsFired += 1;
}

// ---- The whole drone pass ---------------------------------------------

/**
 * Launch a dive if the wave's own clock has reached its next target.
 *
 * The clock advances only while dive launching is on, returns to `0` at each
 * launch, and draws the next target between `DIVE_GAP_MIN` and `DIVE_GAP_MAX`
 * scaled by the stage. A wave with nothing standing in its formation launches
 * nothing and keeps its clock, so the cadence resumes with the formation.
 */
function runDiveLaunching(state: SpectraState, h: number): void {
  if (!state.diveLaunching) return;
  state.diveClock += h;
  if (state.diveClock < state.diveTarget) return;

  const standing = state.drones.filter((drone) => drone.phase === "formation");
  const chosen = randomPick(state, standing);
  if (chosen === undefined) return;

  setDronePhase(chosen, "diving");
  state.diveClock = 0;
  state.diveTarget =
    randomRange(state, DIVE_GAP_MIN, DIVE_GAP_MAX) * diveGapScale(state.stage);
}

/**
 * Advance every drone by `h` seconds: the wave's own release and dive launching,
 * then each drone's locomotion, band clock and fire.
 */
export function advanceDrones(
  state: SpectraState,
  h: number,
  cues: FrameCues,
): void {
  if (state.waveEntry) state.entryClock += h;
  runDiveLaunching(state, h);

  const challenge = isChallengeStage(state.stage);
  const gone: number[] = [];

  for (const drone of state.drones) {
    advanceOscillation(state, drone, h);

    if (drone.travel) {
      switch (drone.phase) {
        case "entering":
          if (!released(state, drone)) break;
          if (challenge) {
            advanceFlyover(state, drone, h);
            if (challengeGone(drone)) gone.push(drone.id);
            break;
          }
          advanceEntrance(state, drone, h);
          break;
        case "formation": {
          drone.phaseClock += h;
          const at = slotPoint(state, drone);
          drone.x = at.x;
          drone.y = at.y;
          break;
        }
        case "diving":
          advanceDive(state, drone, h, cues);
          break;
        case "returning":
          advanceReturn(state, drone, h);
          break;
      }
    }

    fireDive(state, drone);
  }

  if (gone.length > 0) {
    state.drones = state.drones.filter((drone) => !gone.includes(drone.id));
  }
}
