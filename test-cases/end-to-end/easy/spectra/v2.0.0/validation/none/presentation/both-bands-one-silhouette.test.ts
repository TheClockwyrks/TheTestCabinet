// Spectra — presentation/both-bands-one-silhouette: both bands share one
// silhouette.
//
// `specs/assets.md`, "Both bands from one silhouette": each sprite is seeded in
// one band-state only, and "the other band-state is the same silhouette carrying
// the other band's color and the other band's accent. The hull, the crystal, and
// the shell form never change; only the band color and the accent do." For the
// Shard it says it outright: "`shard.png` is the magenta Shard. A cyan Shard is
// the same crystal in cyan with the ring accent." So the second band is the
// PROVIDED ART RE-TINTED, and a build that drew a crystal of its own for one of
// the two bands is the thing this point catches — it would pass every
// `*-from-sprite` point, which reads only the seeded band-state.
//
// SO THE TWO DRAWN SOURCES ARE HELD AGAINST EACH OTHER, NOT AGAINST THE FILE.
// `specs/assets.md` leaves the build the choice of "whether the tint is
// composited over the seeded PNG at draw time or a per-band copy is baked once at
// load time", and a baked copy is a bitmap of the build's own making — so what is
// compared is the ALPHA SILHOUETTE of the source drawn for the cyan Shard against
// the one drawn for the magenta Shard, each normalised to the `SPRITE_SIZE`
// (`64`) square. Both routes keep one shape and pass; a second crystal does not.
// That the shape is the SEEDED one is `presentation/shard-from-sprite`'s
// question, and it is not asked again here.
//
// THE SHARD IS THE PAIR THAT IS READ. `specs/drones.md` makes it "the fixed-band
// drone and the bulk of every formation", so it is the drone a player meets in
// both bands most often, and it is the one sprite `specs/assets.md` spells the
// derivation out for. The two are posed side by side, far enough apart that
// neither one's draw can be attributed to the other, and both are props with
// every faculty off so neither can move, oscillate or fire between the pose and
// the frame that is read.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, fail } from "../assert";
import { SHARD_SIZE, SPRITE_SIZE, type Band } from "../constants";
import {
  blitsNear,
  blitsOfFrame,
  captureStill,
  createHarness,
  poseDrone,
  requireDrone,
  silhouetteAgreement,
  startPosed,
  type Harness,
} from "../harness";
import { bestBlit, describeBlits } from "./reading";

/**
 * How closely the two drawn sources' silhouettes must agree, as a fraction of
 * the `SPRITE_SIZE` (`64`) square's `4096` places.
 *
 * The figure this checklist's five silhouette points are written against: at or
 * above 99% of their pixels once scaled to `SPRITE_SIZE`, which leaves `41`
 * places of slack — enough for the rounding a per-band bake can put on an edge,
 * and far too little for a second crystal, since the closest two of the four
 * seeded sprites agree only at `0.96`.
 */
const AGREE_MIN = 0.99;

/**
 * How far a destination box's centre may sit from the drone it is drawn for, in
 * logical units.
 *
 * Half the Shard's own `SHARD_SIZE` (`28`) footprint, as in the four
 * `*-from-sprite` points.
 */
const CENTRED_MAX = SHARD_SIZE / 2;

/**
 * Where the two Shards stand: one band each, on one row of the play field.
 *
 * `400` units apart, which is more than fourteen footprints, so no glow, halo or
 * accent a build lays around one can reach the other, and each one's draw is
 * unambiguously its own.
 */
const POSED: readonly { band: Band; x: number }[] = [
  { band: "cyan", x: 440 },
  { band: "magenta", x: 840 },
];

/** The row they stand on: inside the play field, clear of the ship's lane. */
const ROW_Y = 420;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws a cyan Shard and a magenta Shard from one silhouette", async () => {
  await startPosed(h);
  const ids: { band: Band; id: number }[] = [];
  for (const { band, x } of POSED) {
    ids.push({ band, id: await poseDrone(h, "shard", x, ROW_Y, { band }) });
  }

  const blits = await blitsOfFrame(h);
  const snapshot = await h.snapshot();

  // A cyan Shard beside a magenta one.
  await captureStill(h, "pair");

  const drawn = ids.map(({ band, id }) => {
    const drone = requireDrone(snapshot, id, `the ${band} Shard being read`);
    const at = { x: drone.x, y: drone.y };
    const blit = bestBlit(blitsNear(blits, at, CENTRED_MAX), "shard");
    if (blit === undefined) {
      fail(
        `a bitmap blitted within ${CENTRED_MAX} units of the ${band} Shard's ` +
          `centre at (${at.x.toFixed(0)}, ${at.y.toFixed(0)}) ` +
          `(specs/assets.md: each entity is drawn from its own sprite, ` +
          `centred on its position)`,
        describeBlits(blitsNear(blits, at, SPRITE_SIZE)),
      );
    }
    return { band, blit };
  });

  assertGreaterThanOrEqual(
    silhouetteAgreement(drawn[0].blit.silhouette, drawn[1].blit.silhouette),
    AGREE_MIN,
    `the source drawn for the ${drawn[0].band} Shard and the one drawn for ` +
      `the ${drawn[1].band} Shard to carry one silhouette, agreeing at or ` +
      `above ${AGREE_MIN} of their ${SPRITE_SIZE}x${SPRITE_SIZE} places ` +
      `(specs/assets.md: the other band-state is the same silhouette carrying ` +
      `the other band's colour; the crystal form never changes); the ` +
      `${drawn[0].band} Shard was drawn from ${describeBlits([drawn[0].blit])} ` +
      `and the ${drawn[1].band} Shard from ${describeBlits([drawn[1].blit])}`,
  );
});
