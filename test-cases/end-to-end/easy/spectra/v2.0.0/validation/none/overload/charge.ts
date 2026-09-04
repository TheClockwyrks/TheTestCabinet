// overload/charge — the four readings this group's checks share.
//
// Only the `overload` group reads a drone's charge, tips a drone over with a
// mismatched shot, and compares two readings of one footprint, so these live
// beside the checks that use them rather than in the shared harness next door.
// Like everything there they fix a READING or a SEQUENCE alone and never a
// threshold: every distance, tolerance and bound a check asserts is stated in
// that check, derived from the figure `specs/` fixes for it.
//
// WHY THE SHOT IS A HELPER. `specs/mode.md` makes the charge the PRECONDITION and
// the mismatched shot the TRIGGER: "Each point poses the drone through
// `setDroneCharge` and tips it over with a REAL mismatched shot, so the pose is
// the precondition and the shot is the trigger; posing the overload itself would
// grade the debug surface rather than the rule." There is deliberately no
// operation that overloads a drone, so every check here reaches an overload the
// same way — by putting one of the player's bullets under the drone carrying the
// band `specs/bands.md` calls the opposite of what the drone reads as, and letting
// the build's own contact and band rules do the rest.
//
// WHICH BAND MISMATCHES IS READ, NOT ASSUMED. `specs/bands.md` decides a contact
// by the two EFFECTIVE bands, and a drone's effective band is its stored band
// taken as the opposite once for each of a broken shell, a shimmer, and an
// inversion. So {@link mismatchBand} reads `effectiveBand` off the snapshot rather
// than negating the band the check posed: a check that poses a Prism with its
// shell broken fires the band that really mismatches it.

import { fail } from "../assert";
import { opposite, type Band } from "../constants";
import {
  colorDistance,
  requireDrone,
  shootDrone,
  type DroneView,
  type Harness,
  type Rgb,
  type Shot,
  type SpectraSnapshot,
  type UntilResult,
} from "../harness";

/**
 * The charge a drone reports, failing the check with what it needed when the
 * build reports none.
 *
 * `charge` is the one snapshot field this variant adds
 * (`specs/instrumentation.md` under the overload variant), so it is optional on
 * the shared `DroneView` — a base build owes it nothing. Under THIS variant a
 * missing field is the build's fault and lands as the verdict of the point that
 * reached for it, rather than as `undefined` quietly failing a comparison.
 */
export function chargeOf(drone: DroneView, doing = "the drone"): number {
  if (drone.charge === undefined) {
    fail(
      `a charge on ${doing}, which every drone carries under this mode (specs/instrumentation.md)`,
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
 * The band a shot must carry to be a MISMATCH against `drone`.
 *
 * The opposite of what the drone reads as, which is what `specs/bands.md` calls
 * the mismatched case: "The bullet's effective band is the opposite | The drone is
 * not destroyed, and the bullet is consumed."
 */
export function mismatchBand(drone: DroneView): Band {
  return opposite(drone.effectiveBand);
}

/**
 * Send one of the player's bullets of the MISMATCHING band up into the drone with
 * that id, and run the game until it has resolved.
 *
 * `shootDrone`'s sequence with the band decided by the reading above rather than
 * by the caller, because under this mode every check in this directory fires the
 * same band for the same reason. Nothing about the outcome is posed: what the
 * contact does to the drone is what the build does with it.
 */
export async function mismatchShot(
  h: Harness,
  id: number,
  shot: Shot,
): Promise<UntilResult & { id: number; band: Band }> {
  const drone = requireDrone(
    await h.snapshot(),
    id,
    "the mismatched shot's target",
  );
  const band = mismatchBand(drone);
  const swept = await shootDrone(h, id, band, shot);
  return { ...swept, band };
}

/**
 * How many samples of two readings of the SAME region sit further apart than
 * `minDistance`.
 *
 * The reading the two telegraph checks turn on: pose one charge, read the
 * footprint; pose another, read it again; and this says how much of the drone
 * changed. Sample for sample, so the two readings must be of the same rectangle
 * at the same step — a pair of different lengths is not comparable and says so
 * rather than quietly comparing the prefix.
 *
 * `minDistance` is the caller's, because what counts as "a pixel that changed" is
 * the check's own figure.
 */
export function differingSamples(
  a: readonly Rgb[],
  b: readonly Rgb[],
  minDistance: number,
): number {
  if (a.length !== b.length) {
    fail(
      `two readings of the same region (${a.length} samples)`,
      `${b.length} samples`,
    );
  }
  let differing = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (colorDistance(a[i], b[i]) > minDistance) differing += 1;
  }
  return differing;
}
