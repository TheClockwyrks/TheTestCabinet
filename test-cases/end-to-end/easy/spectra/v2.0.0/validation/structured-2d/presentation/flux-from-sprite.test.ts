// Spectra — presentation/flux-from-sprite: a Flux is drawn from the seeded Flux.
//
// `specs/assets.md` seeds `flux.png` as "the oscillating drone, caught
// mid-shimmer" and asks the build to draw the entity from it: "Each entity is
// drawn from its own sprite, centered on the entity's position and scaled to that
// entity's footprint." A build that paints a convincing body in code passes every
// other point in this suite and misses this one.
//
// SO THE READING IS THE IMAGE SOURCE, NOT THE PIXELS ON THE STAGE. The source
// each blit was handed is taken, and its ALPHA SILHOUETTE is held against
// `assets/flux.png`'s own, read off the same `assets/` tree the harness serves
// the build from and normalised to the `SPRITE_SIZE` (`64`) square both are
// measured on. The silhouette rather than the pixels, because the drawn Flux
// carries a colour the seeded file does not — `specs/assets.md` settles the held
// part of a band window as "the same body in that band's single color" — while
// the SHAPE it is drawn in is the seeded one either way.
//
// THE FLUX IS POSED MID-HOLD, NOT MID-SHIMMER. `specs/drones.md` gives a band
// window a held part of `FLUX_HOLD_L1` (`1.6`) seconds and a shimmer of
// `FLUX_SHIMMER` (`0.4`), so four fifths of a Flux's life is the held state, and
// `specs/assets.md` requires "the same body" to be drawn in both. The band clock
// is set to the middle of the held part rather than to either boundary, so a
// build that rounds the window's edge differently is still plainly holding, and
// the snapshot's own `shimmer` flag is read as the precondition it is.
//
// IT IS POSED AS A PROP. Oscillation is off, so the band clock stays where it was
// put and the drone cannot slip into a shimmer between the pose and the frame
// that is read; travel and fire are off, so it holds its place and spawns
// nothing. It is put well clear of the ship's lane, so the fighter blitted on the
// ship is not among the draws considered.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual, fail } from "../assert";
import {
  FLUX_HOLD_L1,
  FLUX_SIZE,
  SPRITES,
  SPRITE_SIZE,
} from "../../src/constants";
import {
  captureStill,
  createHarness,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";
import {
  bestBlit,
  blitsNear,
  blitsOfFrame,
  describeBlits,
  droneOf,
} from "./reading";

/**
 * How closely the drawn source's silhouette must agree with the seeded PNG's, as
 * a fraction of the `SPRITE_SIZE` (`64`) square's `4096` places.
 *
 * The figure this checklist's five silhouette points are written against: at or
 * above 99% of its pixels once scaled to `SPRITE_SIZE`, which leaves `41` places
 * of slack — enough for the rounding one rescale can put on an edge, and far too
 * little for a body painted in code or for a different one of the four seeded
 * sprites, since no two of them agree anywhere near it.
 */
const AGREE_MIN = 0.99;

/**
 * How far the destination box's centre may sit from the drone's own, in logical
 * units.
 *
 * Half the Flux's own `FLUX_SIZE` (`30`) footprint. `specs/assets.md` draws each
 * entity "centred on the entity's position", and how a build inks the seeded
 * frame inside that box is its own — but a box whose centre left the drone's own
 * footprint is drawn somewhere other than on the drone.
 */
const CENTRED_MAX = FLUX_SIZE / 2;

/** The middle of a stage-1 band window's held part (`specs/drones.md`). */
const MID_HOLD = FLUX_HOLD_L1 / 2;

/** Where the Flux is posed: inside the play field, clear of the ship's lane. */
const FLUX_AT = { x: 400, y: 420 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("blits a source carrying flux.png's silhouette on a Flux", async () => {
  startPosed(h);
  const id = poseDrone(h, "flux", FLUX_AT.x, FLUX_AT.y, {
    band: "cyan",
    bandClock: MID_HOLD,
  });

  const blits = await blitsOfFrame(h);
  const drone = droneOf(h.snapshot(), id);
  assertEqual(
    drone.shimmer,
    false,
    `precondition: a Flux ${MID_HOLD}s into a band window is holding its band ` +
      `rather than shimmering (specs/drones.md: it shimmers only at or above ` +
      `fluxHold(stage), which is FLUX_HOLD_L1 (${FLUX_HOLD_L1}) on stage 1)`,
  );
  const at = { x: drone.x, y: drone.y };

  // The Flux drawn from the seeded art.
  captureStill(h, "flux");

  const near = blitsNear(blits, at, CENTRED_MAX);
  const drawn = bestBlit(near, "flux");
  if (drawn === undefined) {
    fail(
      `a bitmap blitted within ${CENTRED_MAX} units of the Flux's centre at ` +
        `(${at.x.toFixed(0)}, ${at.y.toFixed(0)}) (specs/assets.md: each ` +
        `entity is drawn from its own sprite, centred on its position)`,
      describeBlits(blitsNear(blits, at, SPRITE_SIZE)),
    );
  }
  assertGreaterThanOrEqual(
    drawn.agreement.flux,
    AGREE_MIN,
    `the source drawn on the Flux to carry assets/${SPRITES.flux}'s alpha ` +
      `silhouette at or above ${AGREE_MIN} of its ${SPRITE_SIZE}x${SPRITE_SIZE} ` +
      `places (specs/assets.md: a Flux holding a band is drawn as the same ` +
      `body in that band's single colour); what was blitted there was ` +
      `${describeBlits([drawn])}`,
  );
});
