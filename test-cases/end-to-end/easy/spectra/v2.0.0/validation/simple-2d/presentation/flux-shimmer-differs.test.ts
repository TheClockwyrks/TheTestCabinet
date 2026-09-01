// Spectra — presentation/flux-shimmer-differs: a shimmering Flux reads
// differently.
//
// `specs/assets.md`: "It is drawn during the shimmer part of a band window.
// During the held part the Flux is settled on one band, and it is drawn as the
// same body in that band's single color and accent, so a shimmering Flux and a
// holding Flux are visibly different." `specs/overview.md`'s legibility table
// carries the same row. It matters in play rather than only to the eye:
// `specs/drones.md` says no shot destroys a shimmering Flux, of either band, so a
// player who cannot see the shimmer wastes shots on a drone that cannot be hit.
//
// BOTH HELD STATES ARE READ, WHICH IS THE WHOLE POINT OF THE POSE. A shimmering
// Flux stores one band and, `specs/drones.md` says, reads as the band it is
// moving toward, which is the opposite of the one it stores — so there are two
// ways to get this wrong, and each survives one comparison. A build that draws
// the shimmer as the band the Flux STORES is caught only against a Flux holding
// that band; a build that draws it as the band the Flux READS AS is caught only
// against a Flux holding the other. So one shimmering Flux is posed between one
// holding cyan and one holding magenta, and it must read apart from both. The
// item's picture — a shimmering Flux beside a holding one — is that frame.
//
// THE READING IS THE PIXELS, HELD PLACE FOR PLACE. The three stand at the same
// `FLUX_SIZE` (`30`) footprint, so the square each occupies is read over the same
// extent and two pictures are compared place for place over everything either of
// them painted — see `presentation/reading`. Held against the same squares of the
// same field with the Fluxes gone, so a build's own starfield is in both readings
// and cannot be what moved.
//
// THE BAND CLOCK IS POSED AT THE MIDDLE OF EACH PART, never at a boundary, so a
// build that rounds the edge of a window differently is still plainly in the part
// it was posed in — and the snapshot's own `shimmer` flag is read as the
// precondition it is. Oscillation is off on all three, so no clock advances
// between the pose and the frame that is read; travel and fire are off too, so
// each holds its place and spawns nothing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { FLUX_HOLD_L1, FLUX_SHIMMER, FLUX_SIZE } from "../../src/constants";
import {
  captureStill,
  createHarness,
  droneOf,
  poseDrone,
  readRegion,
  startPosed,
  type Harness,
  type Region,
} from "../harness";
import { apartness, footprintOf } from "./reading";

/**
 * How far apart the two pictures must read, as a Euclidean RGB distance out of
 * the `441` an RGB cube is across, averaged over everything either of them
 * painted.
 *
 * The figure this item is written against: above `25` of `441`. The
 * specification states the rule and leaves the palette to the build, so what is
 * demanded is a difference a player sees rather than a colour: `25` is above the
 * few units one composite's rounding puts on a pixel, and comfortably below the
 * `40` this checklist calls the least a player reads at a glance — because
 * `specs/assets.md` asks only that the two states be "visibly different", not
 * that they be as far apart as two bands.
 */
const DIFFERS_MIN = 25;

/** The middle of a stage-1 band window's held part (`specs/drones.md`). */
const MID_HOLD = FLUX_HOLD_L1 / 2;

/** The middle of its shimmer (`specs/drones.md`). */
const MID_SHIMMER = FLUX_HOLD_L1 + FLUX_SHIMMER / 2;

/** The row the three stand on: inside the play field, clear of the ship's lane. */
const ROW_Y = 420;

/**
 * Where the three stand, `380` units apart — more than twelve footprints — so no
 * glow or accent a build lays around one can reach another, and each square read
 * holds one Flux and nothing else.
 */
const HELD_CYAN_X = 260;
const SHIMMER_X = 640;
const HELD_MAGENTA_X = 1020;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a shimmering Flux apart from a Flux holding either band", async () => {
  startPosed(h);
  const shimmering = poseDrone(h, "flux", SHIMMER_X, ROW_Y, {
    band: "cyan",
    bandClock: MID_SHIMMER,
  });
  const heldCyan = poseDrone(h, "flux", HELD_CYAN_X, ROW_Y, {
    band: "cyan",
    bandClock: MID_HOLD,
  });
  const heldMagenta = poseDrone(h, "flux", HELD_MAGENTA_X, ROW_Y, {
    band: "magenta",
    bandClock: MID_HOLD,
  });
  await h.advance(1);

  // A shimmering Flux beside a holding one, in each band.
  captureStill(h, "pair");

  const posed = h.snapshot();
  assertEqual(
    droneOf(posed, shimmering).shimmer,
    true,
    `precondition: a Flux ${MID_SHIMMER}s into a band window is shimmering ` +
      `(specs/drones.md: at or above fluxHold(stage), FLUX_HOLD_L1 ` +
      `(${FLUX_HOLD_L1}) on stage 1)`,
  );

  /** Each posed Flux, and the square of stage it occupies. */
  const read = [
    { id: shimmering, name: "the shimmering Flux", holding: false },
    { id: heldCyan, name: "the Flux holding cyan", holding: true },
    { id: heldMagenta, name: "the Flux holding magenta", holding: true },
  ].map(({ id, name, holding }) => {
    const drone = droneOf(posed, id);
    if (holding) {
      assertEqual(
        drone.shimmer,
        false,
        `precondition: ${name} is ${MID_HOLD}s into a band window, holding it ` +
          `rather than shimmering (specs/drones.md)`,
      );
    }
    return { name, square: footprintOf(drone.x, drone.y, FLUX_SIZE) };
  });

  const drawn: Region[] = read.map(({ square }) => readRegion(h, square));

  // The same three squares of the same field with no Flux on them: the control
  // every reading above is held against.
  h.debug.clearDrones();
  await h.advance(1);
  const bare: Region[] = read.map(({ square }) => readRegion(h, square));

  for (const index of [1, 2]) {
    const apart = apartness(bare[0], drawn[0], bare[index], drawn[index]);
    assertGreaterThan(
      apart.distance,
      DIFFERS_MIN,
      `the shimmering Flux to read more than ${DIFFERS_MIN} of 441 from ` +
        `${read[index].name}, averaged over the ${apart.samples} places either ` +
        `of them painted inside their FLUX_SIZE (${FLUX_SIZE}) footprints ` +
        `(specs/assets.md: a shimmering Flux and a holding Flux are visibly ` +
        `different)`,
    );
  }
});
