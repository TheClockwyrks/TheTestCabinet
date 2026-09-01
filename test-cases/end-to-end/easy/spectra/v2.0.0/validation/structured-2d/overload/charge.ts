// overload/charge — the readings and the one sequence this group's checks share.
//
// Only the `overload` group reads a drone's charge, poses one, tips a drone over
// with a mismatched shot, and compares two readings of one footprint, so these
// live beside the checks that use them rather than in the shared harness next
// door. Like everything there they fix a READING or a SEQUENCE alone and never a
// threshold: every distance, tolerance and bound a check asserts is stated in that
// check, derived from the figure `specs/` fixes for it.
//
// WHY THE SHOT IS A HELPER. `specs/mode.md` makes the charge the PRECONDITION and
// the mismatched shot the TRIGGER: there is deliberately no operation that
// overloads a drone, so every check here reaches an overload the same way — by
// putting one of the player's bullets under the drone carrying the band
// `specs/bands.md` calls the opposite of what the drone reads as, and letting the
// build's own contact and band rules do the rest.
//
// WHICH BAND MISMATCHES IS READ, NOT ASSUMED. `specs/bands.md` decides a contact
// by the two EFFECTIVE bands, and a drone's effective band is its stored band
// taken as the opposite once for each of a broken shell, a shimmer, and an
// inversion. So {@link mismatchBand} reads `effectiveBand` off the snapshot rather
// than negating the band the check posed: a check that poses a Prism with its
// shell broken fires the band that really mismatches it.
//
// WHEN A SHOT HAS RESOLVED IS READ OFF THE BULLET. `specs/bands.md` consumes the
// bullet on contact under both outcomes, so a sweep that runs until the bullet
// has left the roster ends on the frame the contact resolved — which is the frame
// `specs/mode.md` states every reaction happens in.

import { fail } from "../assert";
import {
  bulletById,
  droneById,
  posePlayerBullet,
  type Band,
  type DroneSnapshot,
  type Harness,
  type SpectraSnapshot,
  type UntilResult,
} from "../harness";

/** The other of the two bands: `specs/bands.md` fixes exactly two, with no third. */
export function opposite(band: Band): Band {
  return band === "cyan" ? "magenta" : "cyan";
}

/**
 * The drone with that id, failing the check with the scenario it needed.
 *
 * `droneById` answers `undefined` where no drone carries the id, and every check
 * here is about a drone an overload leaves STANDING (`specs/mode.md`: "An overload
 * destroys nothing"), so a missing drone is a verdict rather than a comparison
 * against `undefined` further down.
 */
export function requireDrone(
  snapshot: SpectraSnapshot,
  id: number,
  doing = "the scenario",
): DroneSnapshot {
  const drone = droneById(snapshot, id);
  if (drone === undefined) {
    fail(
      `drone ${String(id)} still on the field (${doing})`,
      `drones ${JSON.stringify(snapshot.drones.map((one) => one.id))}`,
    );
  }
  return drone;
}

/**
 * The charge a drone reports, failing the check with what it needed when the build
 * reports none.
 *
 * `charge` is the one snapshot field this variant adds
 * (`specs/instrumentation.md` under the overload variant), so it is optional on
 * the shared `DroneSnapshot` — a base build owes it nothing. Under THIS variant a
 * missing field is the build's fault and lands as the verdict of the point that
 * reached for it, rather than as `undefined` quietly failing a comparison.
 */
export function chargeOf(drone: DroneSnapshot, doing = "the drone"): number {
  if (drone.charge === undefined) {
    fail(
      `a charge on ${doing}, which every drone carries under this mode ` +
        "(specs/instrumentation.md)",
      "the snapshot's drone reported no charge field",
    );
  }
  return drone.charge;
}

/** The charge of the drone with that id, read off `snapshot`. */
export function chargeById(
  snapshot: SpectraSnapshot,
  id: number,
  doing = "the drone",
): number {
  return chargeOf(requireDrone(snapshot, id, doing), doing);
}

/**
 * Pose a drone's charge through `setDroneCharge`, the one operation that writes it
 * (`specs/instrumentation.md`, under the overload variant).
 *
 * The operation is optional on the case's surface, because a `base` build is never
 * asked for it; under THIS variant a build that carries none is failed here,
 * naming the operation, rather than at whichever comparison would have read the
 * charge it never posed.
 */
export function poseCharge(h: Harness, id: number, charge: number): void {
  const pose = h.debug.setDroneCharge;
  if (typeof pose !== "function") {
    fail(
      "a `setDroneCharge` operation on the surface, which this mode's build " +
        "carries (specs/instrumentation.md)",
      "the surface has no setDroneCharge",
    );
  }
  pose.call(h.debug, id, charge);
}

/** How a mismatched shot is staged: where it starts, and how long it may fly. */
export interface Shot {
  /** How far under the drone's reported centre the bullet is placed, in units. */
  below: number;
  /** The most frames the sweep runs before it gives up. */
  maxFrames: number;
}

/** What a mismatched shot was, beside where the sweep it ran ended. */
export interface MismatchShot extends UntilResult {
  /** The band the bullet carried, read off the drone rather than assumed. */
  band: Band;
  /** The bullet's own id, whose leaving the roster is what ended the sweep. */
  bulletId: number;
}

/**
 * Send one of the player's bullets of the MISMATCHING band up into the drone with
 * that id, and sweep one frame at a time until it has resolved.
 *
 * The band is decided by the reading above rather than by the caller, because
 * under this mode every check in this directory fires the same band for the same
 * reason. Nothing about the outcome is posed: what the contact does to the drone
 * is what the build does with it, and `hit` says only that the bullet left the
 * roster inside the window — which `specs/bands.md` makes the mark of a contact
 * that resolved.
 */
export async function mismatchShot(
  h: Harness,
  id: number,
  shot: Shot,
): Promise<MismatchShot> {
  const drone = requireDrone(
    h.snapshot(),
    id,
    "the mismatched shot's target, read for the band that mismatches it",
  );
  const band = mismatchBand(drone);
  const bulletId = posePlayerBullet(h, drone.x, drone.y + shot.below, band);
  const swept = await h.until(
    (snapshot) => bulletById(snapshot, bulletId) === undefined,
    { maxFrames: shot.maxFrames },
  );
  return { ...swept, band, bulletId };
}

/**
 * The band a shot must carry to be a MISMATCH against `drone`.
 *
 * The opposite of what the drone reads as, which is what `specs/bands.md` calls
 * the mismatched case: "The bullet's effective band is the opposite | The drone is
 * not destroyed, and the bullet is consumed."
 */
export function mismatchBand(drone: DroneSnapshot): Band {
  return opposite(drone.effectiveBand);
}

/**
 * How many pixels of two readings of the SAME region sit further apart than
 * `minDistance`, on the 0-to-441 scale an RGB distance runs on.
 *
 * The reading the two telegraph checks turn on: pose one charge, read the
 * footprint; pose another, read it again; and this says how much of the drone
 * changed. Pixel for pixel, so the two readings must be of the same rectangle — a
 * pair of different lengths is not comparable and says so rather than quietly
 * comparing the prefix.
 *
 * `minDistance` is the caller's, because what counts as "a pixel that changed" is
 * the check's own figure.
 */
export function differingPixels(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  minDistance: number,
): number {
  if (a.length !== b.length || a.length === 0) {
    fail(
      `two readings of the same region (${String(a.length / 4)} pixels)`,
      `${String(b.length / 4)} pixels`,
    );
  }
  let differing = 0;
  for (let i = 0; i < a.length; i += 4) {
    const away = Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1], a[i + 2] - b[i + 2]);
    if (away > minDistance) differing += 1;
  }
  return differing;
}

/** How many pixels a {@link differingPixels} reading was taken over. */
export function pixelsIn(region: Uint8ClampedArray): number {
  return region.length / 4;
}
