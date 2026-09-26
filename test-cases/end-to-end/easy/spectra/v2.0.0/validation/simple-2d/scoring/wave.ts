// Spectra — scoring: the wave the GAME builds, opened and emptied one drone at a
// time.
//
// A LOCAL HELPER, FOR THIS GROUP ONLY. `scoring` is the one group that reads the
// SCORE as an exact number, and the things below are what make such a reading
// mean the payment and nothing else. Neither belongs in `harness.ts`: no other
// group asks what a kill was worth.
//
// WHY THE FOUR STAGE-END CHECKS OPEN A REAL WAVE. `stage-clear-bonus`,
// `perfect-bonus`, `no-perfect-bonus-when-missed` and
// `challenge-pays-no-stage-bonus` are about what a STAGE'S END pays, and a wave
// nothing built has no last drone. So those open the wave the game itself builds,
// through {@link openWave}, and empty it. Every drone the stage built is
// accounted for, so the two readings of "its wave" agree there too.
//
// WHY THE WAVE IS FROZEN RATHER THAN PLAYED. `specs/stages.md` and
// `specs/swarm.md` leave a wave's entrance path, its slots, its dive order and its
// timing to the build, and none of that is what these four points are about.
// {@link openWave} therefore shuts the three world gates and every drone's three
// faculties, so the wave stands exactly as the build laid it out and nothing moves
// except what a check moves. What it does NOT touch is the ROSTER: every drone the
// stage built is still on it.
//
// WHY A KILL IS ONE BULLET AT A TIME. {@link destroyDrone} brings a drone to one
// clear spot and shoots it with a bullet carrying the band it reads as. Doing it
// one at a time rather than in one discharge keeps every payment in those four
// checks on the same route — the bullet — so a build that pays a DISCHARGE the
// wrong figure loses `scoring/discharge-scores-diving` and nothing else. Where a
// drone stands when it is shot decides none of these four points, so bringing it
// to a fixed spot costs the reading nothing and keeps every shot identical.

import { assertTrue, fail } from "../assert";
import {
  droneOf,
  fireAt,
  findDrone,
  startStage,
  type Harness,
  type SpectraSnapshot,
} from "../harness";

/**
 * The one spot every kill in the four stage-end checks happens at.
 *
 * A clear stretch of the play field: below the formation grid's lowest row
 * (`slotY(4)`, `332`) and its full sway, above the ship's lane (`SHIP_Y`, `600`),
 * and to the right of the field's centre.
 */
export const KILL_AT = { x: 900, y: 500 } as const;

/**
 * How far below the target each shot in {@link destroyDrone} starts, in logical
 * units.
 *
 * Geometry, not a tolerance: clear of the largest footprint any drone is drawn at
 * — `PRISM_HALF` (`28`) plus the bullet's `PLAYER_BULLET_HALF` (`6`) is `34` — so
 * the bullet is in flight rather than already in contact whatever kind it is
 * aimed at, and short enough to climb into a drone that is holding still.
 *
 * KEPT AS SHORT AS THAT CLEARANCE ALLOWS, because these four checks empty a whole
 * flyover one drone at a time and every unit of climb is frames of a forty-drone
 * field. The flight a shot needs is most of what these checks cost, and none of
 * it decides anything: where the bullet started is not what any of the four
 * reads.
 */
const SHOT_GAP = 45;

/**
 * Where {@link destroyDrone} stands a Flux's band clock before it shoots it.
 *
 * `0` is the start of a band window, which specs/drones.md puts squarely in the
 * HELD part: the shimmer begins only at `fluxHold(stage)`, `FLUX_HOLD_L1` (`1.6`)
 * seconds at stage 1 and never below `1.0`. It is a position in the window, not a
 * tolerance, and it decides nothing about a payment — a shimmering Flux is simply
 * a drone no shot can reach (specs/drones.md), and these four checks are about
 * what a kill pays rather than about when one is possible.
 */
const HELD_CLOCK = 0;

/**
 * Open the wave the game builds for `stage`, and hold everything on it still.
 *
 * The three world gates are shut, exactly as `startPosed` shuts them and for the
 * same reasons: without them the wave releases groups on its own schedule, the
 * assault launches dives, and a drone or a bullet reaching the ship costs a life
 * and stops the wave. `waveEntry` is the one a caller can keep on, for the single
 * check that needs the wave's own release to have happened so a drone can fly its
 * own way off the field.
 *
 * Every drone's three faculties are shut too, so each holds its exact centre and
 * its phase (specs/instrumentation.md) until a check moves it.
 */
export async function openWave(
  h: Harness,
  stage: number,
  options: { waveEntry?: boolean } = {},
): Promise<SpectraSnapshot> {
  h.debug.reset();
  await startStage(h, stage);

  h.debug.setWaveEntry(options.waveEntry ?? false);
  h.debug.setDiveLaunching(false);
  h.debug.setShipContact(false);

  for (const drone of h.snapshot().drones) {
    h.debug.setDroneTravel(drone.id, false);
    h.debug.setDroneOscillation(drone.id, false);
    h.debug.setDroneFire(drone.id, false);
  }

  const held = h.snapshot();
  assertTrue(
    held.screen === "inWave",
    "precondition: the stage's intro gave way to the live wave " +
      "(specs/stages.md)",
  );
  assertTrue(
    held.stage === stage,
    `precondition: the live wave is stage ${stage}'s`,
  );
  return held;
}

/**
 * Bring the drone with that id to {@link KILL_AT} and destroy it with the
 * player's bullets, then hand back the state that leaves.
 *
 * The shot carries the band the drone READS as — its `effectiveBand`, the one
 * specs/bands.md says decides a contact — so every shot here is the matching case
 * and nothing about a band is being decided. A Prism takes two: the first breaks
 * the shell, the second destroys the core the shell was hiding (specs/drones.md),
 * and its `effectiveBand` is read again in between because breaking the shell
 * swaps it.
 *
 * A FLUX IS SETTLED ONTO A BAND BEFORE IT IS SHOT. "No shot destroys a shimmering
 * Flux, of either band" (specs/drones.md), and a wave the build laid out is free
 * to open a Flux anywhere inside its band window — including the shimmer, where
 * nothing this helper could fire would destroy it. So a Flux's band clock is posed
 * to {@link HELD_CLOCK}, the start of a window, which specs/drones.md puts
 * squarely in the HELD part; with `openWave` holding the oscillation gate shut the
 * clock stays there for the whole flight. WHICH band it then reads is the build's
 * own stored band, read back on the next line rather than assumed. The rhythm
 * itself is `drones`'s to grade; here it is only kept out of a reading that is
 * about a figure.
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
  if (droneOf(h.snapshot(), id).kind === "flux") {
    h.debug.setDroneBandClock(id, HELD_CLOCK);
  }

  // Two shots at most: one layer each for a Prism, one for every other kind.
  for (let shot = 0; shot < 2; shot += 1) {
    if (findDrone(h.snapshot(), id) === null) break;
    const standing = droneOf(h.snapshot(), id);
    // The bursts earlier kills left are cleared first. A destroyed drone pops a
    // burst that plays for `BURST_DURATION`, and these four checks empty a whole
    // wave far faster than that, so without this every later shot is flown over
    // `MAX_BURSTS` live particle systems that are simulated and drawn on every
    // frame of it. None of the four reads a burst — `bursts/` is where that is
    // graded — so what the pile-up decides is how long the check takes.
    h.debug.clearBursts();
    await fireAt(h, KILL_AT.x, KILL_AT.y, standing.effectiveBand, SHOT_GAP);
  }

  const after = h.snapshot();
  if (findDrone(after, id) !== null) {
    fail(
      `drone ${id} destroyed by shots carrying the band it reads as ` +
        "(specs/bands.md: the bullet's effective band equals the drone's, so " +
        "the drone's exposed layer is destroyed)",
      "it was still standing after two matching shots",
    );
  }
  return after;
}

/**
 * Destroy every drone of the opened wave whose id is not in `keep`, in roster
 * order, and hand back the score once they are gone.
 *
 * A caller reads that number as the total the per-drone figures paid before the
 * stage's end was reached.
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
