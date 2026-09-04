// Spectra — presentation/bullet-reads-band: a bullet reads its band.
//
// `specs/assets.md`'s list of what the build draws in code opens with "Every
// bullet, the player's and the drones' alike, IN ITS BAND'S COLOR AND ACCENT",
// and `specs/overview.md`'s legibility table asks that a bullet read apart from
// the field along its lane. `specs/ship.md` gives a shot the ship's band at the
// instant it is fired, fixed for the bullet's whole life, and `specs/bands.md`
// decides what that shot does by that band — so a player watching two shots climb
// has to be able to see which is which.
//
// TWO BULLETS, ONE FRAME, THE BAND THE ONLY DIFFERENCE. Both are the player's,
// both put on the same row of the field, both left to the build's own update for
// the same one frame, so nothing but the band they carry can separate the two
// readings.
//
// NO COLOUR IS ASSERTED. `specs/overview.md` fixes no palette, so what is graded
// is the DISTANCE between the two pictures the build drew, place for place over
// everything either painted, held against the same boxes of the same field with
// the bullets gone — see `presentation/reading`. That those colours are the same
// two the seeded art carries is `presentation/bands-share-one-palette`; this
// point asks only that they be told apart.
//
// THE BOX READ IS THE BULLET'S OWN. `specs/ship.md` draws a player bullet
// `PLAYER_BULLET_W` (`4`) by `PLAYER_BULLET_H` (`16`), and each is read through
// that box at the place the snapshot reports it, so nothing here assumes how far
// the update carried it or demands a speed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual, fail } from "../assert";
import { PLAYER_BULLET_H, PLAYER_BULLET_W, type Band } from "../constants";
import {
  captureStill,
  createHarness,
  lastBullet,
  readRegion,
  requireBullet,
  startPosed,
  type Harness,
  type Rect,
  type Rgb,
} from "../harness";
import { apartness } from "./reading";

/**
 * How far apart the two bands must read on a bullet, as a Euclidean RGB distance
 * out of the `441` an RGB cube is across, averaged over everything either
 * picture painted.
 *
 * The figure this item is written against: at least `60` of `441`, the same the
 * two bands are held to on a drone — `specs/assets.md` draws a bullet wholly in
 * its band's colour and accent rather than marking a band on a neutral body, so
 * there is nothing here to dilute the separation the way a hull does.
 */
const DISTINCT_MIN = 60;

/** The row the two shots are put on: inside the play field, clear of the lane. */
const ROW_Y = 400;

/**
 * Where the two shots are put, `400` units apart, so no glow a build lays around
 * one can reach the box the other is read through.
 */
const POSED: readonly { band: Band; x: number }[] = [
  { band: "cyan", x: 440 },
  { band: "magenta", x: 840 },
];

/**
 * The lattice each box is read on, in logical units.
 *
 * One sample per logical unit, which is one device pixel at this harness's own
 * viewport, so each `4 x 16` box is every one of its `64` pixels.
 */
const READ_STEP = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws a cyan bullet and a magenta bullet in colours told apart", async () => {
  await startPosed(h);
  const ids: { band: Band; id: number }[] = [];
  for (const { band, x } of POSED) {
    await h.debug.addPlayerBullet(x, ROW_Y, band);
    const added = lastBullet(await h.snapshot());
    if (added === undefined) {
      fail(
        "addPlayerBullet to append a bullet to the roster " +
          "(specs/instrumentation.md)",
        "the bullet roster was still empty after addPlayerBullet",
      );
    }
    ids.push({ band, id: added.id });
  }
  await h.advance(1);

  // A cyan bullet beside a magenta one.
  await captureStill(h, "pair");

  const flying = await h.snapshot();
  const read = ids.map(({ band, id }) => {
    const bullet = requireBullet(flying, id, `the ${band} bullet`);
    assertEqual(
      bullet.effectiveBand,
      band,
      `precondition: the ${band} bullet reads as ${band} on the field ` +
        `(specs/bands.md; no inversion is running)`,
    );
    const box: Rect = {
      x: bullet.x - PLAYER_BULLET_W / 2,
      y: bullet.y - PLAYER_BULLET_H / 2,
      width: PLAYER_BULLET_W,
      height: PLAYER_BULLET_H,
    };
    return { band, box };
  });

  const drawn: Rgb[][] = [];
  for (const { box } of read) {
    drawn.push(await readRegion(h, box, READ_STEP));
  }

  // The same two boxes of the same field with no bullet in them: the control
  // every reading above is held against.
  await h.debug.clearPlayerBullets();
  await h.advance(1);
  const bare: Rgb[][] = [];
  for (const { box } of read) {
    bare.push(await readRegion(h, box, READ_STEP));
  }

  const apart = apartness(bare[0], drawn[0], bare[1], drawn[1]);
  assertGreaterThanOrEqual(
    apart.distance,
    DISTINCT_MIN,
    `the cyan bullet and the magenta bullet to read at least ${DISTINCT_MIN} ` +
      `of 441 apart, averaged over the ${apart.samples} places either of them ` +
      `painted inside their PLAYER_BULLET_W (${PLAYER_BULLET_W}) by ` +
      `PLAYER_BULLET_H (${PLAYER_BULLET_H}) boxes (specs/assets.md: every ` +
      `bullet is drawn in its band's colour and accent)`,
  );
});
