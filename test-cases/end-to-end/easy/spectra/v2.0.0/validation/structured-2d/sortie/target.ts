// Spectra — sortie/target: the drone this group's checks fire at, or the failure
// that it is no longer there. LOCAL TO THIS GROUP.
//
// `harness.ts` reads the roster and answers `undefined` where an id no longer
// stands, deliberately: what a missing drone MEANS is the check's to state. In
// this group it means one thing in all three checks — every one of them poses a
// drone, crosses it with a shot of the OPPOSITE band, and then reads something
// back, and `specs/bands.md` says that shot destroys nothing. So a drone that has
// gone is a build that resolved the mismatched contact as a kill, and the reading
// the check wanted cannot be taken at all.
//
// That the drone survives is graded in common by `bands/mismatch-spares`, not
// here; this module only turns "no drone with that id" into the failure the
// reading already implies, so a check does not go on to compare a field read off
// nothing.
//
// It holds no threshold, poses nothing, and decides no rule.

import { fail } from "../assert";
import {
  droneById,
  type DroneSnapshot,
  type SpectraSnapshot,
} from "../harness";

/**
 * The drone with that id, or the failure that the roster no longer holds it.
 *
 * `what` names what the drone was expected to still be, so a build that destroyed
 * it fails against the reading the point needed rather than against a lookup that
 * came back empty.
 */
export function requireDrone(
  snapshot: SpectraSnapshot,
  id: number,
  what: string,
): DroneSnapshot {
  const drone = droneById(snapshot, id);
  if (drone === undefined) {
    fail(
      what,
      `no drone with id ${String(id)} is on the field; the roster holds ` +
        `${JSON.stringify(snapshot.drones.map((one) => one.id))}`,
    );
  }
  return drone;
}
