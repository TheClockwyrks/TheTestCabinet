// overload/charge — the readings and the one sequence this group's checks share.
//
// Only the `overload` group reads a drone's charge, tips a drone over with a
// mismatched shot, and compares two readings of one footprint, so these live beside
// the checks that use them rather than in the shared harness next door. Like
// everything there they fix a READING or a SEQUENCE alone and never a threshold:
// every distance, tolerance and bound a check asserts is stated in that check,
// derived from the figure `specs/` fixes for it.
//
// WHY THE SHOT IS A HELPER. `specs/mode.md` makes the charge the PRECONDITION and
// the mismatched shot the TRIGGER: there is deliberately no operation that
// overloads a drone, so every check here reaches an overload the same way — by
// putting one of the player's bullets under the drone carrying the band
// `specs/bands.md` calls the opposite of what the drone reads as, and letting the
// build's own contact and band rules do the rest.
//
// WHICH BAND MISMATCHES IS READ, NOT ASSUMED. `specs/bands.md` decides a contact by
// the two EFFECTIVE bands, and a drone's effective band is its stored band taken as
// the opposite once for each of a broken shell, a shimmer, and an inversion. So
// {@link mismatchBand} reads `effectiveBand` off the snapshot rather than negating
// the band the check posed: a check that poses a Prism with its shell broken fires
// the band that really mismatches it.

import { fail } from "../assert";
import {
  droneOf,
  fireAt,
  type Band,
  type DroneSnapshot,
  type Harness,
  type Region,
  type SpectraSnapshot,
} from "../harness";

/** The other of the two bands specs/bands.md fixes; there is no third. */
export function opposite(band: Band): Band {
  return band === "cyan" ? "magenta" : "cyan";
}

/**
 * The charge a drone reports, failing the check with what it needed when the build
 * reports none.
 *
 * `charge` is the one snapshot field this variant adds
 * (`specs/instrumentation.md` under the overload variant), so it is optional on the
 * shared `DroneSnapshot` — a base build owes it nothing. Under THIS variant a
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
  return chargeOf(droneOf(snapshot, id), doing);
}

/**
 * The band a shot must carry to be a MISMATCH against `drone`.
 *
 * The opposite of what the drone reads as, which is what `specs/bands.md` calls the
 * mismatched case: "The bullet's effective band is the opposite | The drone is not
 * destroyed, and the bullet is consumed."
 */
export function mismatchBand(drone: DroneSnapshot): Band {
  return opposite(drone.effectiveBand);
}

/** What a mismatched shot was: the band it carried and the bullet it was. */
export interface MismatchShot {
  band: Band;
  bulletId: number;
}

/**
 * Send one of the player's bullets of the MISMATCHING band up into the drone with
 * that id, and run the frames its climb takes.
 *
 * `fireAt`'s sequence — a bullet placed `gap` under the drone's reported centre and
 * flown the frames `PLAYER_BULLET_SPEED` needs to cover that gap — with the band
 * decided by the reading above rather than by the caller, because under this mode
 * every check in this directory fires the same band for the same reason. Nothing
 * about the outcome is posed: what the contact does to the drone is what the build
 * does with it.
 */
export async function mismatchShot(
  h: Harness,
  id: number,
  gap: number,
): Promise<MismatchShot> {
  const drone = droneOf(h.snapshot(), id);
  const band = mismatchBand(drone);
  const bulletId = await fireAt(h, drone.x, drone.y, band, gap);
  return { band, bulletId };
}

/**
 * A logical box covering the whole footprint a drone of `size` is drawn at, centred
 * on `(x, y)`.
 *
 * `specs/mode.md` puts the telegraph "within its own footprint", so the two
 * telegraph checks read exactly that square and nothing around it.
 */
export function footprint(
  x: number,
  y: number,
  size: number,
): { x: number; y: number; w: number; h: number } {
  return { x: x - size / 2, y: y - size / 2, w: size, h: size };
}

/**
 * How far apart two readings of the same place must sit to count as repainted, on
 * the 0-to-441 scale an RGB distance runs on.
 *
 * THIS IS THE READING, NOT A THRESHOLD. It decides which places of a footprint
 * count as having been drawn on again, and how far they moved is never asserted:
 * specs/mode.md leaves "where on the drone the telegraph sits and how it is drawn"
 * to the build, so the treatment is the reviewer's to rate. Two readings of one
 * place nothing was drawn on are identical, so anything above zero would do; 12 is
 * a little above the rounding one composite can put on a pixel.
 */
export const PAINT_MIN = 12;

/**
 * How many pixels of two readings of the SAME region sit further apart than
 * `minDistance`.
 *
 * The reading the two telegraph checks turn on: pose one charge, read the
 * footprint; pose another, read it again; and this says how much of the drone
 * changed. Pixel for pixel, so the two readings must be of the same rectangle — a
 * pair of different sizes is not comparable and says so rather than quietly
 * comparing the prefix.
 *
 * `minDistance` is the caller's; every check in this group passes
 * {@link PAINT_MIN}.
 */
export function differingPixels(
  a: Region,
  b: Region,
  minDistance: number,
): number {
  if (a.width !== b.width || a.height !== b.height) {
    fail(
      `two readings of the same region (${a.width}x${a.height} pixels)`,
      `${b.width}x${b.height} pixels`,
    );
  }
  let differing = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const away = Math.hypot(
      a.data[i] - b.data[i],
      a.data[i + 1] - b.data[i + 1],
      a.data[i + 2] - b.data[i + 2],
    );
    if (away > minDistance) differing += 1;
  }
  return differing;
}

/** How many pixels a region holds, which is what a share of it is taken of. */
export function pixelsIn(region: Region): number {
  return region.width * region.height;
}
