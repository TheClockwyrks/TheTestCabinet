// Spectra — drones/roster: the drone a point is about, or the failure that it is
// gone. LOCAL TO THIS GROUP.
//
// `harness.ts` reads the roster and reports `undefined` where an id no longer
// stands, deliberately: what a missing drone MEANS is the check's to state. In
// this group it means one thing over and over — the requirement is a rule about a
// drone that is meant to be standing still, and a build that took it off the
// field has broken exactly the rule under test, so the point should be named for
// that rather than for a field read off nothing. The statement is made once here
// and every check that reads a field off a drone it expects to survive goes
// through it.
//
// It holds no threshold and decides no rule. It turns "no drone with that id"
// into the failure the point already implies, and hands back the drone the check
// then asserts against.

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
 * it fails against the requirement rather than against a lookup that came back
 * empty.
 */
export function requireDrone(
  snapshot: SpectraSnapshot,
  id: number,
  what: string,
): DroneSnapshot {
  const drone = droneById(snapshot, id);
  if (drone === undefined) fail(what, "no drone with that id is on the field");
  return drone;
}
