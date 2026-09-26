// field — reading a drone the check itself posed back off the roster.
// LOCAL TO THIS GROUP.
//
// The harness's `droneById` answers `undefined` where no drone carries the id,
// and says so deliberately: what a missing reading MEANS is the check's to state.
// The stage's three sway points all mean the same thing by it, and they mean it
// dozens of times each — a drone posed into a slot with travel its only faculty,
// read once every few frames across a whole `SWAY_PERIOD`. For them, a drone that
// has left the roster is the build failing the point rather than a reading to
// interpret: `startPosed` shuts the wave's entry and dive gates and the ship's
// contact test, nothing else is on the field, and nothing in specs/field.md's
// account of the sway removes a drone. So the three share one reading that names
// what it required and lets the check carry on with a value rather than a
// maybe-value.
//
// It is here rather than in `harness.ts` because it is a reading of the SWAY
// scenario: what to make of an absent drone is a different thing in a group about
// destruction, where a drone leaving the roster is the requirement.

import { fail } from "../assert";
import {
  droneById,
  type DroneSnapshot,
  type SpectraSnapshot,
} from "../harness";

/**
 * The drone `id` names, or the failure that it is no longer on the roster.
 *
 * `what` names the scenario the drone was posed for, so a failure says which
 * sweep lost it rather than only that a lookup came back empty.
 */
export function droneOnRoster(
  snapshot: SpectraSnapshot,
  id: number,
  what: string,
): DroneSnapshot {
  const drone = droneById(snapshot, id);
  if (drone === undefined) {
    fail(
      `drone ${String(id)} to still be on the roster ${what} — nothing in this ` +
        "scenario removes a drone (specs/field.md)",
      `the roster holds ${String(snapshot.drones.length)} drones and none is it`,
    );
  }
  return drone;
}
