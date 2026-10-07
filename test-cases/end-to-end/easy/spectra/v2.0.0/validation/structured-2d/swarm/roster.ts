// Spectra — swarm/roster: the entity a point is about, or the failure that it is
// gone. LOCAL TO THIS GROUP.
//
// `harness.ts` reads a roster and answers `undefined` where no entity carries the
// id, deliberately: what a missing reading MEANS is the check's to state. In this
// group it means one thing over and over — the requirement is a rule about a drone
// or a bullet that is meant to still be flying, and a build that took it off the
// field has broken exactly the rule under test. `startPosed` shuts the wave's entry
// and dive gates and the ship's contact test, and nothing in specs/swarm.md's
// account of an entrance, a dive, a return or a falling bullet removes the thing
// under test inside the span these points sweep, so a reading that came back empty
// is the point failing rather than a value to interpret.
//
// It holds no threshold and decides no rule. It turns "nothing with that id" into
// the failure the point already implies, and hands back the entity the check then
// asserts against.

import { fail } from "../assert";
import {
  bulletById,
  droneById,
  type BulletSnapshot,
  type DroneSnapshot,
  type SpectraSnapshot,
} from "../harness";

/**
 * The drone with that id, or the failure that the roster no longer holds it.
 *
 * `what` names what the drone was expected to still be, so a build that lost it
 * fails against the requirement rather than against a lookup that came back empty.
 */
export function requireDrone(
  snapshot: SpectraSnapshot,
  id: number,
  what: string,
): DroneSnapshot {
  const drone = droneById(snapshot, id);
  if (drone === undefined) {
    fail(
      `${what} to still be on the drone roster (specs/swarm.md)`,
      `the roster holds ${String(snapshot.drones.length)} drones and none is it`,
    );
  }
  return drone;
}

/** The bullet with that id, or the failure that the roster no longer holds it. */
export function requireBullet(
  snapshot: SpectraSnapshot,
  id: number,
  what: string,
): BulletSnapshot {
  const bullet = bulletById(snapshot, id);
  if (bullet === undefined) {
    fail(
      `${what} to still be in flight (specs/swarm.md)`,
      `the roster holds ${String(snapshot.bullets.length)} bullets and none is it`,
    );
  }
  return bullet;
}
