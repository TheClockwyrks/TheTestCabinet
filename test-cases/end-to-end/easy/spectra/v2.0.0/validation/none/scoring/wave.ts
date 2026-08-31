// Spectra — scoring: opening the wave the GAME builds, and destroying it one
// drone at a time.
//
// A LOCAL HELPER, FOR FOUR POINTS ONLY. Every other check in this group poses
// its own drone with `poseDrone` and reads what one shot paid. Four cannot:
// `stage-clear-bonus`, `perfect-bonus`, `no-perfect-bonus-when-missed` and
// `challenge-pays-no-stage-bonus` are all about what a STAGE'S END pays, and a
// stage clears "in the moment the last drone of its wave is destroyed"
// (`specs/stages.md`) — a wave nothing built has no last drone. So those four
// open the wave the game itself builds, through `startStage`, and empty it.
//
// WHY THE WAVE IS FROZEN RATHER THAN PLAYED. `specs/stages.md` and
// `specs/swarm.md` leave a wave's entrance path, its slots, its dive order and
// its timing to the build, and none of that is what these four points are
// about. {@link openWave} therefore shuts the wave's own faculties — the three
// world gates — and every drone's three faculties, so the wave stands exactly as
// the build laid it out and nothing moves except what a check moves. What it
// does NOT touch is the roster: every drone the stage built is still there, so
// "the last drone of its wave" means the same thing under either reading of that
// phrase (see `startPosed`'s note), and the stage really does end.
//
// WHY A KILL IS ONE BULLET AT A TIME. {@link destroyDrone} brings a drone to one
// clear spot and shoots it with a bullet carrying the band it reads as. Doing it
// one at a time rather than in one discharge keeps every payment in these four
// checks on the same route — the bullet — so a build that pays a DISCHARGE the
// wrong figure loses `scoring/discharge-scores-diving` and nothing else. Where a
// drone stands when it is shot decides none of these four points, so bringing it
// to a fixed spot costs the reading nothing and keeps every shot identical.

import { assertEqual, assertTrue, fail } from "../assert";
import {
  droneById,
  fireAt,
  startStage,
  type DroneView,
  type Harness,
  type SpectraSnapshot,
} from "../harness";

/**
 * The one spot every kill in these four checks happens at.
 *
 * A clear stretch of the play field: below the formation grid's lowest row
 * (`332`) and its full sway, above the ship's lane (`SHIP_Y`, `600`), and to the
 * right of the field's centre so a shot that misses climbs a column no formation
 * slot stands in.
 */
export const KILL_AT = { x: 900, y: 500 } as const;

/**
 * How far below the target each shot starts, in logical units.
 *
 * Clear of the largest footprint any drone is drawn at — `PRISM_HALF` (`28`)
 * plus the bullet's `PLAYER_BULLET_HALF` (`6`) is `34` — so the bullet is in
 * flight rather than already in contact whatever kind it is aimed at, and short
 * enough to climb into a drone that is holding still.
 */
const SHOT_BELOW = 90;

/**
 * Open the wave the game builds for `stage`, and hold everything on it still.
 *
 * The three world gates are shut, exactly as {@link startPosed} shuts them and
 * for the same reasons: without them the wave releases groups on its own
 * schedule, the assault launches dives, and a drone or a bullet reaching the
 * ship costs a life and stops the wave. `waveEntry` is the one a caller can keep
 * on, for the single check that needs a drone of a later group to be released so
 * it can fly its own way off the field.
 *
 * Every drone's three faculties are shut too, so each holds its exact centre and
 * its phase (`specs/instrumentation.md`) until a check moves it.
 */
export async function openWave(
  h: Harness,
  stage: number,
  options: { waveEntry?: boolean } = {},
): Promise<SpectraSnapshot> {
  await h.debug.reset();
  await startStage(h, stage);

  await h.debug.setWaveEntry(options.waveEntry ?? false);
  await h.debug.setDiveLaunching(false);
  await h.debug.setShipContact(false);

  const opened = await h.snapshot();
  for (const drone of opened.drones) {
    await h.debug.setDroneTravel(drone.id, false);
    await h.debug.setDroneOscillation(drone.id, false);
    await h.debug.setDroneFire(drone.id, false);
  }

  const held = await h.snapshot();
  assertEqual(
    held.screen,
    "inWave",
    "precondition: the stage's intro gave way to the live wave " +
      "(specs/stages.md)",
  );
  assertEqual(
    held.stage,
    stage,
    `precondition: the live wave is stage ${stage}'s`,
  );
  return held;
}

/**
 * Bring the drone with that id to {@link KILL_AT} and destroy it with the
 * player's bullets, then hand back the state that leaves.
 *
 * The shot carries the band the drone READS as — its `effectiveBand`, the one
 * `specs/bands.md` says decides a contact — so every shot here is the matching
 * case and nothing about a band is being decided. A Prism takes two: the first
 * breaks the shell, the second destroys the core the shell was hiding
 * (`specs/drones.md`), and its `effectiveBand` is read again in between because
 * breaking the shell swaps it.
 *
 * It fails, rather than returning, if the drone is still standing afterwards: a
 * check about what a stage's end pays cannot go on with a drone it believes it
 * destroyed.
 */
export async function destroyDrone(
  h: Harness,
  id: number,
): Promise<SpectraSnapshot> {
  await h.debug.setDronePosition(id, KILL_AT.x, KILL_AT.y);

  // Two shots at most: one layer each for a Prism, one for every other kind.
  for (let shot = 0; shot < 2; shot += 1) {
    const standing = droneById(await h.snapshot(), id);
    if (standing === undefined) break;
    await fireAt(h, KILL_AT.x, KILL_AT.y, standing.effectiveBand, {
      below: SHOT_BELOW,
    });
  }

  const after = await h.snapshot();
  if (droneById(after, id) !== undefined) {
    fail(
      `drone ${id} destroyed by shots carrying the band it reads as ` +
        `(specs/bands.md: the bullet's effective band equals the drone's, so ` +
        `the drone's exposed layer is destroyed)`,
      "it was still standing after two matching shots",
    );
  }
  return after;
}

/** Every drone of the opened wave whose kind is `kind`, in roster order. */
export function ofKind(
  snapshot: SpectraSnapshot,
  kind: DroneView["kind"],
): DroneView[] {
  return snapshot.drones.filter((drone) => drone.kind === kind);
}

/**
 * Destroy every drone of the wave whose id is not in `keep`, in roster order.
 *
 * Hands back the score once they are gone, which a caller reads as the total the
 * per-drone figures paid before the stage's end is reached.
 */
export async function destroyAllBut(
  h: Harness,
  keep: readonly number[],
): Promise<number> {
  const opened = await h.snapshot();
  const doomed = opened.drones
    .map((drone) => drone.id)
    .filter((id) => !keep.includes(id));
  assertTrue(
    doomed.length > 0,
    "precondition: the wave holds a drone to destroy",
  );

  let after = opened;
  for (const id of doomed) after = await destroyDrone(h, id);
  return after.score;
}
