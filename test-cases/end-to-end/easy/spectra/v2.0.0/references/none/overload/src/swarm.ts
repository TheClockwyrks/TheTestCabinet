// Spectra — how any drone enters, holds formation, dives, fires and comes home.
//
// `specs/swarm.md` is the same for all three kinds, so this file is too: what a
// Shard, a Flux and a Prism do DIFFERENTLY is `src/drones.ts`. What is here is the
// four phases and the locomotion under them.
//
// THREE FACULTIES, THREE GATES. Locomotion, a Flux's band clock and a dive's fire
// are three separate things a drone does, and each has its own gate
// (`specs/instrumentation.md`). `travel` off holds the drone's exact centre and
// cancels nothing; `fire` off flies the whole dive silent. Every function below
// reads its own gate and no other, which is what lets a scenario isolate one
// faculty without a side effect from another.
//
// EVERY PATH IS CONTINUOUS. A dive turns back above `FIELD_BOTTOM` — the first of
// the two endings `specs/swarm.md` allows — so no dive in this build ever enters
// the bottom HUD strip and none holds a discontinuity.

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
  diveGapScale,
  droneSpeedScale,
  swayOffset,
} from "./constants";
import { nextRange, pick } from "./rng";
import { smoothPath, type Path, type Vec2 } from "./paths";
import type { Drone, SpectraState } from "./types";

/** The `y` a dive turns back at: below the fire line, above the bottom HUD strip. */
export const DIVE_TURN_Y = 646;

/**
 * The deepest `y` a dive's own curve may reach.
 *
 * A smoothed curve overshoots the knot it turns at, so the samples are bounded a
 * few units above `FIELD_BOTTOM`: a dive that loops back turns above the field's
 * bottom edge and never enters the bottom HUD strip, which is the ending
 * `specs/swarm.md` states this build takes.
 */
export const DIVE_FLOOR_Y = FIELD_BOTTOM - 4;

/** The `y` a drone's entrance starts at, above the play field. */
export const ENTRY_Y = -60;

/** How far outside the field an entrance may swing, so the swoop stays readable. */
const ENTRY_X_MARGIN = 40;

/** A value between `a` and `b`. */
function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}

/** An entrance's `x`, kept near enough the stage that the swoop reads on screen. */
function entryX(x: number): number {
  return Math.max(
    FIELD_LEFT - ENTRY_X_MARGIN,
    Math.min(FIELD_RIGHT + ENTRY_X_MARGIN, x),
  );
}

/**
 * The curved swoop that carries a drone from above the field down into its slot.
 *
 * It crosses `FIELD_TOP` well inside one second of travel at `ENTER_SPEED`, curves
 * back across the upper field, and ends at the slot — the three things
 * `specs/swarm.md` asks of an entrance.
 */
export function entrancePath(
  slotCentreX: number,
  slotCentreY: number,
  fromLeft: boolean,
): Path {
  const side = fromLeft ? -1 : 1;
  return smoothPath([
    { x: entryX(slotCentreX + side * 260), y: ENTRY_Y },
    { x: entryX(slotCentreX + side * 150), y: 150 },
    {
      x: entryX(slotCentreX - side * 70),
      y: Math.max(FIELD_TOP + 20, slotCentreY - 50),
    },
    { x: slotCentreX, y: slotCentreY },
  ]);
}

/** Where a drone's entrance begins, which is where it waits until it is released. */
export function entranceStart(slotCentreX: number, fromLeft: boolean): Vec2 {
  return { x: entryX(slotCentreX + (fromLeft ? -260 : 260)), y: ENTRY_Y };
}

/**
 * The swooping dive that closes on the ship.
 *
 * The deepest knot sits at the ship's current `x`, so the path BENDS TOWARD THE
 * SHIP rather than running a fixed track, and it opens with a swing away from the
 * ship so the run stays wide enough to dodge. It turns back at
 * {@link DIVE_TURN_Y}, above `FIELD_BOTTOM`.
 */
export function divePath(from: Vec2, shipX: number, swing: number): Path {
  const descent = Math.max(120, DIVE_TURN_Y - from.y);
  const yAt = (f: number): number => from.y + (DIVE_TURN_Y - from.y) * f;
  return smoothPath(
    [
      { x: from.x, y: from.y },
      { x: entryX(from.x + swing), y: yAt(0.25) },
      { x: lerp(from.x, shipX, 0.65), y: yAt(0.62) },
      { x: shipX, y: DIVE_TURN_Y },
      {
        x: entryX(shipX - swing * 1.2),
        y: DIVE_TURN_Y - Math.max(200, descent * 0.5),
      },
    ],
    { maxY: DIVE_FLOOR_Y },
  );
}

/** The path a drone that has finished its dive travels back to its slot along. */
export function returnPath(
  from: Vec2,
  slotCentreX: number,
  slotCentreY: number,
): Path {
  return smoothPath([
    { x: from.x, y: from.y },
    { x: lerp(from.x, slotCentreX, 0.55), y: lerp(from.y, slotCentreY, 0.45) },
    { x: slotCentreX, y: slotCentreY },
  ]);
}

/**
 * The flyover one challenge drone sweeps the field along.
 *
 * A gentle arc from off one side to off the other, at a stated `y` band. It never
 * touches a formation slot, and the drone is retired when the path is done.
 */
export function challengePath(
  y: number,
  fromLeft: boolean,
  offset: number,
): Path {
  const dir = fromLeft ? 1 : -1;
  const startX = fromLeft ? -60 - offset : FIELD_RIGHT + 60 + offset;
  const endX = fromLeft ? FIELD_RIGHT + 80 : -80;
  return smoothPath([
    { x: startX, y },
    { x: startX + dir * 340, y: y - 46 },
    { x: startX + dir * 680, y: y + 56 },
    { x: startX + dir * 1020, y: y - 36 },
    { x: endX, y },
  ]);
}

/** How fast `drone` travels along its current path, in units per second. */
export function travelSpeed(state: SpectraState, drone: Drone): number {
  // A challenge flyover does not scale: whatever stage it falls on, it runs at the
  // stage-1 figures (specs/stages.md).
  const scale = drone.challenge ? 1 : droneSpeedScale(state.stage);
  if (drone.phase === "entering") return ENTER_SPEED * scale;
  const dive = DIVE_SPEED * scale;
  return drone.phase === "diving" && drone.plunge
    ? dive * OVERLOAD_DIVE_SCALE
    : dive;
}

/** Put `drone` into `phase`, resetting what belongs to the phase it is entering. */
export function enterPhase(drone: Drone, phase: Drone["phase"]): void {
  drone.phase = phase;
  drone.phaseTime = 0;
  drone.pathDist = 0;
  if (phase === "diving") {
    drone.diveShots = 0;
    drone.fireArmed = false;
    drone.invertedThisDive = false;
  }
  if (phase === "formation" || phase === "entering") {
    drone.plunge = false;
  }
}

/**
 * Build the dive path `drone` is about to fly, from wherever it stands.
 *
 * Kept apart from {@link launchDive} because a dive is reached two ways: the wave
 * launches one, and a caller poses the phase. Posing the phase is a pose of ONE
 * FIELD, so the path is built here, on the first sub-step the drone spends diving,
 * and the dive that follows is the game's own.
 */
export function beginDive(state: SpectraState, drone: Drone): void {
  // The swing is away from the ship, so the run opens wide before it closes.
  const away = drone.x <= state.ship.x ? -1 : 1;
  const swing = away * nextRange(state, 50, 110);
  drone.pathDist = 0;
  drone.path = divePath({ x: drone.x, y: drone.y }, state.ship.x, swing);
}

/** Launch `drone` into a dive from wherever it stands, aimed at the ship. */
export function launchDive(
  state: SpectraState,
  drone: Drone,
  plunge = false,
): void {
  enterPhase(drone, "diving");
  drone.plunge = plunge;
  beginDive(state, drone);
}

/**
 * Advance the wave's own release of entry groups.
 *
 * The clock starts at zero when the wave opens and advances with game time while
 * the wave's entry runs; a drone's group is released when it reaches
 * `ENTER_GROUP_GAP` times the group's index. A drone that has not been released
 * holds its starting point, and one already travelling flies on whatever the gate
 * does.
 */
export function releaseEntryGroups(state: SpectraState, h: number): void {
  if (!state.waveEntry) return;
  state.entryClock += h;
  for (const drone of state.drones) {
    if (drone.released) continue;
    if (state.entryClock + 1e-9 >= drone.group * ENTER_GROUP_GAP) {
      drone.released = true;
    }
  }
}

/**
 * Choose and launch the wave's next dive.
 *
 * The clock advances only while dive launching runs and returns to `0` at each
 * launch. The first dive waits `DIVE_FIRST_DELAY`; each later one waits a value
 * drawn between `DIVE_GAP_MIN` and `DIVE_GAP_MAX`, scaled for the stage.
 */
export function advanceDiveClock(state: SpectraState, h: number): void {
  if (!state.diveLaunching) return;
  state.diveClock += h;
  if (state.diveClock < state.nextDiveGap) return;
  const standing = state.drones.filter(
    (drone) => drone.phase === "formation" && !drone.challenge,
  );
  const chosen = pick(state, standing);
  // With nothing resting in the formation there is nothing to launch, and the
  // clock stays where it is so the next drone to settle is taken at once.
  if (chosen === undefined) {
    state.diveClock = state.nextDiveGap;
    return;
  }
  launchDive(state, chosen);
  state.diveClock = 0;
  state.nextDiveGap =
    nextRange(state, DIVE_GAP_MIN, DIVE_GAP_MAX) * diveGapScale(state.stage);
}

/** Whether `drone`'s centre has just crossed the fire line travelling downward. */
export function crossedFireLine(previousY: number, y: number): boolean {
  return previousY < DIVE_FIRE_Y && y >= DIVE_FIRE_Y;
}

/** Whether a diving drone has travelled past the bottom of the play field. */
export function belowField(y: number): boolean {
  return y > FIELD_BOTTOM;
}

/** The sway offset every slotted drone carries at this instant. */
export function currentSway(state: SpectraState): number {
  return swayOffset(state.swayClock);
}
