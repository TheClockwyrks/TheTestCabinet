// Spectra — how a drone behaves, whatever kind it is.
//
// The four phases, the entrance's release, the formation's hold on the swaying
// slot, the dive and its fire, and the return (specs/swarm.md). What the three
// kinds do differently is here too, where it is a difference in MOVEMENT or in
// FIRE: a Prism's two-band burst, a Flux holding its shot until it settles, and a
// Prism crossing `PRISM_INVERT_Y` inverting the field instead of dying there
// (specs/drones.md). What a shot DOES to a drone is `src/game.ts`.
//
// EVERY FACULTY IS GATED SEPARATELY. `travel` gates locomotion alone, so a Flux
// can be held still while its band clock runs; `oscillation` gates that clock
// alone; `fire` gates the shots a dive takes. The wave's own two faculties are
// gated the same way, by `waveEntry` and `diveLaunching`
// (specs/instrumentation.md).

import {
  DIVE_FIRE_Y,
  DIVE_GAP_MAX,
  DIVE_GAP_MIN,
  DIVE_SPEED,
  ENEMY_BULLET_SPEED,
  ENTER_GROUP_GAP,
  ENTER_SPEED,
  FIELD_TOP,
  FIELD_BOTTOM,
  INVERSION_TIME,
  PRISM_INVERT_Y,
  SHIP_X_MAX,
  SHIP_X_MIN,
  bulletSpeedScale,
  diveGapScale,
  droneSpeedScale,
  fluxWindow,
  isChallengeStage,
  opposite,
  swayOffset,
  type Band,
} from "./constants";
import { isShimmering } from "./bands";
import { raise } from "./cues";
import { smoothPath, type Vec2 } from "./paths";
import { Rng } from "./rng";
import type { Bullet, Drone, DronePhase, SpectraState } from "./types";

/** How far past `FIELD_BOTTOM` a dive travels before it wraps through it. */
const WRAP_BELOW = 40;
/** How far above `FIELD_TOP` a wrapped dive re-appears. */
const WRAP_ABOVE = 40;
/** The deepest a looping dive turns back at, well clear of the bottom strip. */
const LOOP_TURN_Y = 580;
/** Below this, a dive can only be a wrap: there is no room to loop back. */
const WRAP_FORCED_BELOW = 520;

/** The speed a drone travels its entrance at, at the current stage. */
export function enterSpeed(state: SpectraState): number {
  return ENTER_SPEED * stageSpeedScale(state);
}

/** The speed a drone travels a dive or a return at, at the current stage. */
export function diveSpeed(state: SpectraState): number {
  return DIVE_SPEED * stageSpeedScale(state);
}

/** A challenge stage does not scale: it runs at the stage-1 figures. */
function stageSpeedScale(state: SpectraState): number {
  return isChallengeStage(state.stage) ? 1 : droneSpeedScale(state.stage);
}

/** The formation's offset right now: every slotted drone carries this one value. */
export function sway(state: SpectraState): number {
  return swayOffset(state.swayClock);
}

/** A dive from `(sx, sy)` that swoops toward `shipX` and turns back up. */
export function loopDivePath(
  sx: number,
  sy: number,
  shipX: number,
  slotX: number,
): ReturnType<typeof smoothPath> {
  const side = sx < shipX ? 1 : -1;
  const knots: Vec2[] = [
    { x: sx, y: sy },
    { x: sx + side * 130, y: sy + 150 },
    { x: shipX, y: 470 },
    { x: shipX - side * 110, y: LOOP_TURN_Y },
    { x: slotX - side * 90, y: 380 },
  ];
  return smoothPath(knots);
}

/** A dive from `(sx, sy)` that swoops toward `shipX` and runs off the bottom. */
export function wrapDivePath(
  sx: number,
  sy: number,
  shipX: number,
): ReturnType<typeof smoothPath> {
  const side = sx < shipX ? 1 : -1;
  const knots: Vec2[] = [
    { x: sx, y: sy },
    { x: sx + side * 140, y: sy + 170 },
    { x: shipX, y: 450 },
    { x: shipX + side * 50, y: 620 },
    { x: shipX + side * 90, y: 780 },
  ];
  return smoothPath(knots);
}

/** The way back from `(x, y)` to a slot, curving up over the field. */
export function returnPath(
  x: number,
  y: number,
  targetX: number,
  targetY: number,
): ReturnType<typeof smoothPath> {
  const knots: Vec2[] = [
    { x, y },
    { x: (x + targetX) / 2, y: Math.max(FIELD_TOP + 20, targetY - 90) },
    { x: targetX, y: targetY },
  ];
  return smoothPath(knots);
}

/** The entrance back to a slot from wherever a drone stands. */
function reentrancePath(
  x: number,
  y: number,
  targetX: number,
  targetY: number,
): ReturnType<typeof smoothPath> {
  return returnPath(x, y, targetX, targetY);
}

/**
 * Put `drone` into `phase`, and set up whatever that phase needs.
 *
 * The one door into a phase change, so a dive launched by the assault and a dive
 * posed through the debug surface run the same path code from there
 * (specs/instrumentation.md).
 */
export function enterPhase(
  state: SpectraState,
  drone: Drone,
  phase: DronePhase,
): void {
  drone.phase = phase;
  drone.phaseSeconds = 0;
  drone.pathDist = 0;
  switch (phase) {
    case "entering":
      // A posed entrance is an entrance in progress, so the drone is released.
      drone.released = true;
      drone.path = reentrancePath(drone.x, drone.y, drone.slotX, drone.slotY);
      break;
    case "formation":
      drone.path = null;
      break;
    case "diving": {
      drone.released = true;
      drone.shots = 0;
      drone.firePending = false;
      // A Prism always presses all the way to the bottom: reaching it is what
      // inverts the field, which is the threat the kind exists for. The other two
      // mix a looping dive with one that runs off the bottom and wraps — and a
      // drone already low on the field has no room to loop.
      const rng = new Rng(state.rngState);
      const wrap = rng.unit() < 0.4;
      state.rngState = rng.state;
      const forced = drone.kind === "prism" || drone.y >= WRAP_FORCED_BELOW;
      drone.path =
        forced || wrap
          ? wrapDivePath(drone.x, drone.y, state.ship.x)
          : loopDivePath(drone.x, drone.y, state.ship.x, drone.slotX);
      break;
    }
    case "returning":
      drone.released = true;
      drone.path = returnPath(
        drone.x,
        drone.y,
        drone.slotX + sway(state),
        drone.slotY,
      );
      break;
  }
}

/**
 * Release every entry group whose time has come, and advance the entry clock.
 *
 * The clock runs only while the wave's entry runs, so `setWaveEntry(false)`
 * leaves the roster exactly as it stands — and a drone already travelling its
 * entrance flies it as usual, because that is locomotion, not release.
 */
export function releaseEntryGroups(state: SpectraState, h: number): void {
  if (!state.waveEntry) return;
  state.entryClock += h;
  releaseDueGroups(state);
}

/** Release every group the entry clock has reached. */
export function releaseDueGroups(state: SpectraState): void {
  if (!state.waveEntry) return;
  for (const drone of state.drones) {
    if (drone.released) continue;
    if (state.entryClock >= ENTER_GROUP_GAP * drone.entryGroup) {
      drone.released = true;
    }
  }
}

/**
 * Advance the wave's dive clock and launch a dive when it reaches the gap.
 *
 * The clock returns to `0` only when a dive is actually launched, so a wave whose
 * formation is still assembling launches its first dive the moment a drone is
 * standing in it.
 */
export function runDiveLauncher(state: SpectraState, h: number): void {
  if (!state.diveLaunching) return;
  if (isChallengeStage(state.stage)) return;
  state.diveClock += h;
  if (state.diveClock < state.diveGap) return;
  const standing = state.drones.filter(
    (drone) => drone.phase === "formation" && !drone.dead,
  );
  if (standing.length === 0) return;
  const rng = new Rng(state.rngState);
  const chosen = standing[rng.index(standing.length)];
  state.diveGap =
    rng.range(DIVE_GAP_MIN, DIVE_GAP_MAX) * diveGapScale(state.stage);
  state.rngState = rng.state;
  if (chosen === undefined) return;
  state.diveClock = 0;
  enterPhase(state, chosen, "diving");
}

/** Every drone's own faculties, for one sub-step of `h` seconds. */
export function stepDrones(state: SpectraState, h: number): void {
  for (const drone of state.drones) {
    if (drone.dead) continue;
    drone.phaseSeconds += h;
    stepBandClock(state, drone, h);
    stepMotion(state, drone, h);
  }
}

/**
 * A Flux's band window.
 *
 * The clock runs inside the current window and the STORED BAND flips only at the
 * window's end, where the clock returns to zero. Nothing else moves either, which
 * is what lets `setDroneBand` and `setDroneBandClock` each own one field.
 */
function stepBandClock(state: SpectraState, drone: Drone, h: number): void {
  if (drone.kind !== "flux" || !drone.oscillation) return;
  const window = fluxWindow(state.stage);
  drone.bandClock += h;
  while (drone.bandClock >= window) {
    drone.bandClock -= window;
    drone.band = opposite(drone.band);
  }
}

/** One drone's locomotion, and the fire its dive carries. */
function stepMotion(state: SpectraState, drone: Drone, h: number): void {
  if (!drone.travel) {
    // Held: it keeps its exact centre and its phase. Nothing is cancelled,
    // completed, or resolved early — and its firing still runs.
    tryFire(state, drone);
    return;
  }
  switch (drone.phase) {
    case "entering":
      if (!drone.released) return;
      stepAlongPath(state, drone, enterSpeed(state) * h);
      if (pathDone(drone)) {
        if (isChallengeStage(state.stage)) {
          // A challenge drone never settles into a slot: it sweeps across and
          // leaves, and one that leaves the field is removed.
          drone.dead = true;
          drone.popAt = 0;
        } else {
          enterPhase(state, drone, "formation");
          drone.x = drone.slotX + sway(state);
          drone.y = drone.slotY;
        }
      }
      break;
    case "formation":
      drone.x = drone.slotX + sway(state);
      drone.y = drone.slotY;
      break;
    case "diving": {
      const before = drone.y;
      stepAlongPath(state, drone, diveSpeed(state) * h);
      crossFireLine(state, drone, before);
      tryFire(state, drone);
      if (invertsAtBottom(state, drone, before)) break;
      if (drone.y > FIELD_BOTTOM + WRAP_BELOW) {
        if (isChallengeStage(state.stage)) {
          drone.dead = true;
          drone.popAt = 0;
        } else {
          // The one discontinuity a dive ever holds: it re-appears above the
          // field and heads back to its slot.
          drone.x = Math.min(SHIP_X_MAX, Math.max(SHIP_X_MIN, drone.x));
          drone.y = FIELD_TOP - WRAP_ABOVE;
          enterPhase(state, drone, "returning");
        }
      } else if (pathDone(drone)) {
        if (isChallengeStage(state.stage)) {
          drone.dead = true;
          drone.popAt = 0;
        } else {
          enterPhase(state, drone, "returning");
        }
      }
      break;
    }
    case "returning":
      stepAlongPath(state, drone, diveSpeed(state) * h);
      if (pathDone(drone)) {
        enterPhase(state, drone, "formation");
        drone.x = drone.slotX + sway(state);
        drone.y = drone.slotY;
      }
      break;
  }
}

/** Advance a drone along its current path by `distance` logical units. */
function stepAlongPath(
  _state: SpectraState,
  drone: Drone,
  distance: number,
): void {
  const path = drone.path;
  if (path === null) return;
  drone.pathDist += distance;
  const point = path.at(drone.pathDist);
  drone.x = point.x;
  drone.y = point.y;
}

/** Whether a drone has reached the end of its path. */
function pathDone(drone: Drone): boolean {
  const path = drone.path;
  return path === null || drone.pathDist >= path.length;
}

/**
 * A diver's centre crossing `DIVE_FIRE_Y` downward buys it the shot its kind
 * takes.
 *
 * The crossing is what is detected; the shot is taken by `tryFire`, which is
 * what lets a shimmering Flux hold its shot until it settles.
 */
function crossFireLine(
  state: SpectraState,
  drone: Drone,
  before: number,
): void {
  if (isChallengeStage(state.stage)) return;
  if (!drone.fire) return;
  if (drone.shots > 0 || drone.firePending) return;
  if (before < DIVE_FIRE_Y && drone.y >= DIVE_FIRE_Y) drone.firePending = true;
}

/**
 * The shot a diver owes, taken as soon as its kind can take it.
 *
 * A Shard and a Flux take exactly one shot over a dive and a Prism exactly two,
 * fired together, one carrying each band. A Flux fires nothing while it
 * shimmers, so one that is shimmering at the crossing takes its shot as soon as
 * it settles, if it is still diving.
 */
export function tryFire(state: SpectraState, drone: Drone): void {
  if (!drone.firePending || !drone.fire) return;
  if (drone.phase !== "diving") return;
  if (isChallengeStage(state.stage)) return;
  if (drone.kind === "flux" && isShimmering(state, drone)) return;

  const speed = ENEMY_BULLET_SPEED * bulletSpeedScale(state.stage);
  if (drone.kind === "prism") {
    // Both bands at once, so it threatens the ship whichever band the ship holds.
    spawnEnemyBullet(state, drone.x - 8, drone.y, "cyan", speed);
    spawnEnemyBullet(state, drone.x + 8, drone.y, "magenta", speed);
    drone.shots = 2;
  } else {
    spawnEnemyBullet(state, drone.x, drone.y, drone.band, speed);
    drone.shots = 1;
  }
  drone.firePending = false;
}

/** One enemy bullet, travelling straight down, carrying its firer's band. */
export function spawnEnemyBullet(
  state: SpectraState,
  x: number,
  y: number,
  band: Band,
  speed: number,
): Bullet {
  const bullet: Bullet = {
    id: state.nextId++,
    x,
    y,
    vx: 0,
    vy: speed,
    band,
    friendly: false,
    dead: false,
  };
  state.bullets.push(bullet);
  return bullet;
}

/**
 * A diving Prism whose centre crosses `PRISM_INVERT_Y` downward inverts the
 * whole field and heads back to its slot, unharmed by the crossing.
 *
 * Returns whether it did, so the caller stops resolving this drone's dive.
 */
function invertsAtBottom(
  state: SpectraState,
  drone: Drone,
  before: number,
): boolean {
  if (drone.kind !== "prism") return false;
  if (isChallengeStage(state.stage)) return false;
  if (before >= PRISM_INVERT_Y || drone.y < PRISM_INVERT_Y) return false;
  // At most one inversion is active: a fresh trigger sets the remaining time back
  // rather than adding to it.
  state.inversion = INVERSION_TIME;
  raise(state, "inversion");
  enterPhase(state, drone, "returning");
  return true;
}
