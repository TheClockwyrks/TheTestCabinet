// Spectra — scoring/wave: opening the wave the GAME builds, and emptying it one
// drone at a time. LOCAL TO THIS GROUP.
//
// FOR FOUR POINTS ONLY. Every other check in this group poses its own drone with
// `poseDrone` and reads what one shot paid. Four cannot: `stage-clear-bonus`,
// `perfect-bonus`, `no-perfect-bonus-when-missed` and
// `challenge-pays-no-stage-bonus` are all about what a STAGE'S END pays, and a
// stage clears "in the moment the last drone of its wave is destroyed"
// (`specs/stages.md`) — a wave nothing built has no last drone. So those four open
// the wave the game itself builds, through `startStage`, and empty it.
//
// WHY THE WAVE IS FROZEN RATHER THAN PLAYED. `specs/stages.md` and
// `specs/swarm.md` leave a wave's entrance path, its slots, its dive order and its
// timing to the build, and none of that is what these four points are about.
// {@link openWave} therefore holds every DRONE still — each one's three faculties
// off, so it keeps its exact centre and its phase (`specs/instrumentation.md`) —
// and shuts the two world gates that would otherwise bring the assault to it. What
// it does NOT touch is the roster: `specs/swarm.md` says "The drone roster holds
// every drone of the wave from that moment", so every drone the stage built is
// still there and "the last drone of its wave" means the same thing under either
// reading of that phrase.
//
// AND WHY THE WAVE'S OWN ENTRY IS LEFT RUNNING. It is the one world gate these four
// points must not touch. `specs/swarm.md` gives the wave a clock that "advances
// with game time while the wave's entry runs", and a stage's end is the wave's own
// event — so a build is free to read that clock in deciding when a flyover is over,
// exactly as `specs/stages.md` lets a standard stage refuse to clear on a wave that
// "has had none removed". Shutting the gate freezes the clock and would demand of
// every build that its stage-end rule ignore it, which is a requirement no spec
// states and which these four points are not about. Left running, the gate releases
// drones and moves none: every drone's travel gate is shut, and
// `specs/instrumentation.md` gates locomotion there and nowhere else.
//
// WHY A KILL IS ONE BULLET AT A TIME. {@link destroyDrone} brings a drone to one
// clear spot and shoots it with a bullet carrying the band it reads as. Doing it
// one at a time rather than in one discharge keeps every payment in these four
// checks on the same route — the bullet — so a build that pays a DISCHARGE the
// wrong figure loses `scoring/discharge-scores-diving` and nothing else. Where a
// drone stands when it is shot decides none of these four points, so bringing it
// to a fixed spot costs the reading nothing and keeps every shot identical.
//
// IT HOLDS NO FIGURE. The bonuses and the per-drone figures the four points read
// are stated in their own files, beside the sentence of `specs/scoring.md` each
// comes from. What is fixed here is arrangement: which gates are shut, where a
// kill happens, and that a kill really happened.

import { assertEqual, assertTrue, fail } from "../assert";
import {
  droneById,
  startStage,
  type DroneKind,
  type DroneSnapshot,
  type Harness,
  type SpectraSnapshot,
} from "../harness";
import { shootDrone } from "./scene";

/**
 * The one spot every kill in these four checks happens at.
 *
 * A clear stretch of the play field: below the formation grid's lowest row
 * (`FORM_ROW0_Y + 4 * SLOT_DY`, `332`) and its full `SWAY_AMP` sway, above the
 * ship's lane (`SHIP_Y`, `600`), and to the right of the field's centre so a shot
 * that misses climbs a column no formation slot stands in.
 */
export const KILL_AT = { x: 900, y: 500 } as const;

/**
 * Open the wave the game builds for `stage`, and hold everything on it still.
 *
 * Two world gates are shut, and neither is any of these four points'.
 * `diveLaunching` off means the assault chooses no drone to dive, and the ship's
 * contact test off means no incidental touch costs a life and ends the run under a
 * reading about a score. The THIRD gate, the wave's own entry, is deliberately left
 * as the game has it — on — for the reason stated at the top of this file.
 *
 * Every drone's three faculties are shut, so each holds its exact centre and its
 * phase (`specs/instrumentation.md`) until a check moves it. That is what makes a
 * running entry gate harmless: it releases drones, and locomotion is gated per
 * drone rather than by it.
 *
 * The two preconditions it reads back are the ground all four points stand on: a
 * reading about what a stage's end pays is worth nothing taken from a stage that
 * never opened.
 */
export async function openWave(
  h: Harness,
  stage: number,
): Promise<SpectraSnapshot> {
  h.debug.reset();
  await startStage(h, stage);

  h.debug.setDiveLaunching(false);
  h.debug.setShipContact(false);

  for (const drone of h.snapshot().drones) {
    h.debug.setDroneTravel(drone.id, false);
    h.debug.setDroneOscillation(drone.id, false);
    h.debug.setDroneFire(drone.id, false);
  }

  const held = h.snapshot();
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
 * A Flux caught mid-shimmer is settled onto the band it is holding first, because
 * "No shot destroys a shimmering Flux, of either band" (`specs/drones.md`) and a
 * wave's Flux starts wherever the build's own generator put it.
 * `setDroneBandClock` "moves the clock and nothing else" — `shimmer` follows it
 * and `band` does not change (`specs/instrumentation.md`) — so this settles the
 * drone without deciding anything a check in this group is about; the rhythm
 * itself is `drones`'s to grade.
 *
 * It fails, rather than returning, if the drone is still standing afterwards: a
 * check about what a stage's end pays cannot go on with a drone it believes it
 * destroyed.
 */
export async function destroyDrone(
  h: Harness,
  id: number,
): Promise<SpectraSnapshot> {
  h.debug.setDronePosition(id, KILL_AT.x, KILL_AT.y);
  if (droneById(h.snapshot(), id)?.shimmer === true) {
    h.debug.setDroneBandClock(id, 0);
  }

  // Two shots at most: one layer each for a Prism, one for every other kind.
  for (let shot = 0; shot < 2; shot += 1) {
    const standing = droneById(h.snapshot(), id);
    if (standing === undefined) break;
    await shootDrone(h, id, standing.effectiveBand);
  }

  const after = h.snapshot();
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
  kind: DroneKind,
): DroneSnapshot[] {
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
  const opened = h.snapshot();
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
