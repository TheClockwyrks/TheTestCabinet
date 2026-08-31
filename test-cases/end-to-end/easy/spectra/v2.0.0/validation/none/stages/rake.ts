// Spectra — stages/rake: the game's own stage-1 wave, raked down to one drone.
// LOCAL TO THIS GROUP.
//
// Two of this group's points turn on the same moment: the destruction of the LAST
// drone of a stage's wave. `stages/clears-on-last-drone` grades that the live wave
// ends there; `stages/stage-cleared-screen` grades which screen that opens. Both
// need the same arrangement, and it is not one a pose can produce.
//
// WHY THE GAME BUILDS THE WAVE. `specs/stages.md` clears a stage on "the last
// drone of ITS WAVE", and leaves a build free to read that either way: as the
// drones the stage itself built, or as the drones standing on the field. A drone
// posed into an emptied field is the last drone of the wave only under the second
// reading, so a check posed that way grades which reading the build took. The
// stage's own wave, raked down to one of its own drones, is the arrangement where
// the two readings agree.
//
// WHAT THE RAKE DOES, AND WHY EACH PART OF IT IS HERE.
//
//   - `startStage` runs stage 1's intro out, so the build's own code builds the
//     wave. Nothing about the wave is fabricated.
//   - Every drone of it but one Shard is REMOVED through the surface. The roster
//     never empties, so no clear can be triggered by the raking itself; what is
//     left is one of the wave's own drones.
//   - A Shard, because it is the kind that dies to one matching shot: a Prism owes
//     two and a Flux is only killable while it holds a band, and neither is what
//     these points are about.
//   - THE THREE WORLD GATES ARE SHUT. Without `setWaveEntry(false)` the stage's
//     own wave releases its next group half a second in and the survivor stops
//     being the last drone; without `setDiveLaunching(false)` the survivor can be
//     pulled into a dive mid-scenario; without `setShipContact(false)` the ship
//     can lose a life and enter the `ready` phase, which stops the wave. Each is
//     the wave's own faculty rather than any entity's.
//   - THE SURVIVOR IS PARKED AND MADE INERT. It is set down at a fixed point in
//     open field with its slot under it and every faculty off, so a shot fired
//     straight up reaches a target that is where it was put. Its band is read back
//     rather than posed, so the caller fires the band the wave gave it.
//
// It asserts no verdict: it fails only when the game is not even in the situation
// its callers need, and then with what it needed named.

import { fail } from "../assert";
import { FORM_CENTER_X, type Band } from "../constants";
import { dronesOfKind, startStage, type Harness } from "../harness";

/**
 * Where the survivor is parked: the centre column, mid-field.
 *
 * Clear of both HUD strips, clear of the ship's lane at `SHIP_Y`, and on the
 * ship's own `x`, so a bullet placed under it climbs straight into it.
 */
export const SURVIVOR_AT = { x: FORM_CENTER_X, y: 300 } as const;

/** The one drone of the game's own stage-1 wave the rake left standing. */
export interface Survivor {
  id: number;
  /** The band it reads and counts as, read back rather than posed. */
  band: Band;
}

/** Open stage 1's own wave and rake it down to one inert Shard of its own. */
export async function rakeToLastDrone(h: Harness): Promise<Survivor> {
  const { debug } = h;
  await startStage(h, 1);

  const built = await h.snapshot();
  const shards = dronesOfKind(built, "shard");
  const survivor = shards[0];
  if (survivor === undefined) {
    fail(
      "the stage-1 wave to hold at least one Shard (specs/swarm.md)",
      `a wave of ${built.drones.length} drones holding none`,
    );
  }

  await debug.setWaveEntry(false);
  await debug.setDiveLaunching(false);
  await debug.setShipContact(false);

  for (const drone of built.drones) {
    if (drone.id !== survivor.id) await debug.removeDrone(drone.id);
  }

  await debug.setDroneTravel(survivor.id, false);
  await debug.setDroneOscillation(survivor.id, false);
  await debug.setDroneFire(survivor.id, false);
  await debug.setDronePhase(survivor.id, "formation");
  await debug.setDroneSlot(survivor.id, SURVIVOR_AT.x, SURVIVOR_AT.y);
  await debug.setDronePosition(survivor.id, SURVIVOR_AT.x, SURVIVOR_AT.y);

  return { id: survivor.id, band: survivor.effectiveBand };
}
