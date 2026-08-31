// Spectra — presentation/prism-from-sprite: a Prism is drawn from the seeded
// Prism.
//
// `specs/assets.md` seeds `prism.png` as "the two-band drone, shell around core"
// and asks the build to draw the entity from it: "Each entity is drawn from its
// own sprite, centered on the entity's position and scaled to that entity's
// footprint." A build that paints a convincing two-layer disc in code passes
// every other point in this suite and misses this one.
//
// SO THE READING IS THE IMAGE SOURCE, NOT THE PIXELS ON THE STAGE. The source
// each blit was handed is captured, and its ALPHA SILHOUETTE is held against
// `assets/prism.png`'s own, read off the same `assets/` tree the build was seeded
// with and normalised to the `SPRITE_SIZE` (`64`) square both are measured on.
// The silhouette rather than the pixels, because `specs/assets.md` leaves the
// build the choice of "whether the tint is composited over the seeded PNG at draw
// time or a per-band copy is baked once at load time" — both keep the seeded
// SHAPE, and neither keeps the seeded colours.
//
// THE PRISM IS POSED WITH ITS SHELL INTACT, IN THE BAND THE FILE IS SEEDED IN.
// `prism.png` is "a cyan shell around a magenta core", so a Prism storing cyan
// with its shell standing is the state the seeded file depicts, and this point
// asks the plain question — is the seeded art drawn at all. The other two states
// belong elsewhere: the swapped-band construction to
// `presentation/both-bands-one-silhouette`, and the shell-broken Prism, which
// `specs/assets.md` draws as "the inner layer alone", to
// `presentation/prism-core-alone`. Reading a broken Prism here would demand the
// seeded silhouette of a draw the specification says is only part of it.
//
// IT IS POSED AS A PROP. Every faculty is off, so the Prism holds the place it
// was put and nothing it could do disturbs the frame that is read; and it is put
// well clear of the ship's lane, so the fighter blitted on the ship is not among
// the draws considered.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual, fail } from "../assert";
import { PRISM_SIZE, SPRITE_SIZE, SPRITES } from "../constants";
import {
  blitsNear,
  blitsOfFrame,
  captureStill,
  createHarness,
  poseDrone,
  requireDrone,
  startPosed,
  type Harness,
} from "../harness";
import { bestBlit, describeBlits } from "./reading";

/**
 * How closely the drawn source's silhouette must agree with the seeded PNG's,
 * as a fraction of the `SPRITE_SIZE` (`64`) square's `4096` places.
 *
 * The figure this checklist's five silhouette points are written against: at or
 * above 99% of its pixels once scaled to `SPRITE_SIZE`, which leaves `41` places
 * of slack — enough for the rounding one rescale can put on an edge, and far too
 * little for a disc painted in code or for a different one of the four seeded
 * sprites, since the closest two of them agree at `0.96`.
 */
const AGREE_MIN = 0.99;

/**
 * How far the destination box's centre may sit from the drone's own, in logical
 * units.
 *
 * Half the whole Prism's own `PRISM_SIZE` (`56`) footprint. `specs/assets.md`
 * draws each entity "centred on the entity's position", and how a build inks the
 * seeded frame inside that box is its own — but a box whose centre left the
 * drone's own footprint is drawn somewhere other than on the drone.
 */
const CENTRED_MAX = PRISM_SIZE / 2;

/** Where the Prism is posed: inside the play field, clear of the ship's lane. */
const PRISM_AT = { x: 400, y: 420 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("blits a source carrying prism.png's silhouette on a whole Prism", async () => {
  await startPosed(h);
  const id = await poseDrone(h, "prism", PRISM_AT.x, PRISM_AT.y, {
    band: "cyan",
    shell: true,
  });

  const blits = await blitsOfFrame(h);
  const drone = requireDrone(await h.snapshot(), id, "the Prism being read");
  assertEqual(
    drone.shellAlive,
    true,
    "precondition: the Prism is posed with its outer shell standing " +
      "(specs/drones.md)",
  );
  const at = { x: drone.x, y: drone.y };

  // The Prism, drawn from the seeded art.
  await captureStill(h, "prism");

  const near = blitsNear(blits, at, CENTRED_MAX);
  const drawn = bestBlit(near, "prism");
  if (drawn === undefined) {
    fail(
      `a bitmap blitted within ${CENTRED_MAX} units of the Prism's centre at ` +
        `(${at.x.toFixed(0)}, ${at.y.toFixed(0)}) (specs/assets.md: each ` +
        `entity is drawn from its own sprite, centred on its position)`,
      describeBlits(blitsNear(blits, at, SPRITE_SIZE)),
    );
  }
  assertGreaterThanOrEqual(
    drawn.agreement.prism,
    AGREE_MIN,
    `the source drawn on the whole Prism to carry assets/${SPRITES.prism}'s ` +
      `alpha silhouette at or above ${AGREE_MIN} of its ` +
      `${SPRITE_SIZE}x${SPRITE_SIZE} places (specs/assets.md: each entity is ` +
      `drawn from its own sprite); what was blitted there was ` +
      `${describeBlits([drawn])}`,
  );
});
