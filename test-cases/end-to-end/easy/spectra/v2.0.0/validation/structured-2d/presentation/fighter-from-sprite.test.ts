// Spectra — presentation/fighter-from-sprite: the ship is drawn from the seeded
// fighter.
//
// `specs/assets.md` seeds four PNGs and puts the ship among the things the build
// DRAWS from them rather than from art of its own: "Each entity is drawn from its
// own sprite, centered on the entity's position", and `fighter.png` is "the ship
// tuned to cyan". `specs/ship.md` says the same from the other side: the hull is
// drawn from the seeded fighter art. A build that paints a convincing hull in
// code passes every other point in this suite and misses this one, which is why
// the point exists.
//
// SO THE READING IS THE IMAGE SOURCE, NOT THE PIXELS ON THE STAGE. Every bitmap
// the frame handed `drawImage` is taken with the source it was handed, and that
// source's ALPHA SILHOUETTE is held against `assets/fighter.png`'s own, read off
// the same `assets/` tree the harness serves the build from and normalised to the
// `SPRITE_SIZE` (`64`) square both are measured on. The silhouette rather than
// the pixels, because `specs/assets.md` leaves the build the choice of "whether
// the tint is composited over the seeded PNG at draw time or a per-band copy is
// baked once at load time" — both keep the seeded SHAPE, and neither keeps the
// seeded colours. A build free to lay a glow of its own around the hull is not
// held to anything but this: SOMETHING blitted on the ship carries the seeded
// silhouette.
//
// THE SHIP IS POSED ON CYAN, the band `fighter.png` is seeded in, so this point
// asks the plain question — is the seeded art drawn at all — and leaves the
// derivation of the other band-state to `presentation/both-bands-one-silhouette`.
//
// WHY THE LIVES READOUT IS NOT WHAT IS READ. `specs/assets.md` permits the lives
// readout to "reuse the fighter sprite at a small size", and a build that does
// blits `fighter.png` in the bottom HUD strip as well. Only the blits centred
// within half the hull's own footprint of the ship's position count, which is
// tens of units clear of that strip.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, fail } from "../assert";
import { SHIP_W, SHIP_Y, SPRITES, SPRITE_SIZE } from "../../src/constants";
import {
  captureStill,
  createHarness,
  startPosed,
  type Harness,
} from "../harness";
import { bestBlit, blitsNear, blitsOfFrame, describeBlits } from "./reading";

/**
 * How closely the drawn source's silhouette must agree with the seeded PNG's, as
 * a fraction of the `SPRITE_SIZE` (`64`) square's `4096` places.
 *
 * The figure this item is written against: at or above 99% of its pixels once
 * scaled to `SPRITE_SIZE`, which leaves `41` places of slack — enough for the
 * rounding one rescale can put on an edge, and far too little for a hull painted
 * in code or for a different one of the four seeded sprites, since no two of them
 * agree anywhere near it.
 */
const AGREE_MIN = 0.99;

/**
 * How far the destination box's centre may sit from the ship's own, in logical
 * units.
 *
 * Half the hull's width. `specs/assets.md` draws each entity "centred on the
 * entity's position", and how a build inks the seeded frame inside that box is
 * its own — but a box whose centre left the hull's own footprint is drawn
 * somewhere other than on the ship.
 */
const CENTRED_MAX = SHIP_W / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("blits a source carrying fighter.png's silhouette on the ship", async () => {
  // The ship alone: no drone, no bullet and no burst, and the ship on cyan at
  // the centre of its lane, which is where `startPosed` leaves it.
  startPosed(h);

  const blits = await blitsOfFrame(h);
  const at = { x: h.snapshot().ship.x, y: SHIP_Y };

  // The ship drawn from the seeded fighter.
  captureStill(h, "ship");

  const near = blitsNear(blits, at, CENTRED_MAX);
  const drawn = bestBlit(near, "fighter");
  if (drawn === undefined) {
    fail(
      `a bitmap blitted within ${CENTRED_MAX} units of the ship's centre at ` +
        `(${at.x.toFixed(0)}, ${at.y}) (specs/ship.md: the hull is drawn from ` +
        `the seeded fighter art, centred on its position)`,
      describeBlits(blitsNear(blits, at, SPRITE_SIZE)),
    );
  }
  assertGreaterThanOrEqual(
    drawn.agreement.fighter,
    AGREE_MIN,
    `the source drawn on the ship to carry assets/${SPRITES.fighter}'s alpha ` +
      `silhouette at or above ${AGREE_MIN} of its ${SPRITE_SIZE}x${SPRITE_SIZE} ` +
      `places (specs/assets.md: each entity is drawn from its own sprite); ` +
      `what was blitted there was ${describeBlits([drawn])}`,
  );
});
