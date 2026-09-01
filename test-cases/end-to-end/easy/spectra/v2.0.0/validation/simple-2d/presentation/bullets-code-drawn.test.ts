// Spectra — presentation/bullets-code-drawn: bullets are drawn in code.
//
// `specs/assets.md` closes with the list of what NO seeded file covers, and its
// first row is "Every bullet, the player's and the drones' alike, in its band's
// color and accent". Four PNGs are seeded and a bullet is not among them, so a
// build that reached for one of the four to draw a shot is drawing a fighter, a
// crystal or a Prism where a bullet belongs.
//
// THE POINT HAS TWO HALVES AND NEEDS BOTH. That no seeded frame is blitted at the
// bullet decides nothing on its own — a build that drew no bullet at all would
// pass it — so the same posed bullet is also read on the pixels: it must paint
// the box it occupies apart from the field behind it. Together they say what the
// item claims: something is drawn there, and it is not one of the seeded sprites.
//
// WHAT "IN CODE" IS NOT TAKEN TO MEAN. `specs/assets.md` says only that no seeded
// file covers a bullet; it does not forbid a build from pre-rendering a shape of
// its own onto a bitmap and blitting that, which is an ordinary way to draw a
// glow once instead of per frame. So the negative half asks whether a SEEDED
// FRAME was drawn there — whether a source carrying one of the four seeded
// silhouettes was blitted on the bullet — rather than whether any bitmap was.
//
// THE BULLET IS REALLY IN FLIGHT. It is added through the surface and the game's
// own update is run, so it carries the velocity the build gave it and is drawn
// wherever that update put it; the box read is the one the snapshot reports it
// at, so nothing here freezes it or assumes how far it travelled.
// `specs/ship.md` fixes the drawn size, `PLAYER_BULLET_W` (`4`) by
// `PLAYER_BULLET_H` (`16`), and that box is what is read.
//
// NOTHING ELSE IS ON THE FIELD. `startPosed` leaves no drone, no other bullet and
// no burst, and the shot is put three hundred units clear of the ship, so the only
// draw near the box is the bullet's own and the fighter blitted on the hull is not
// among the blits considered.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertLessThan } from "../assert";
import { PLAYER_BULLET_H, PLAYER_BULLET_W, SPRITES } from "../../src/constants";
import {
  bulletOf,
  captureStill,
  createHarness,
  lastBullet,
  readRegion,
  startPosed,
  type Harness,
} from "../harness";
import {
  apartFromField,
  blitsNear,
  blitsOfFrame,
  boxOf,
  describeBlits,
  type SpriteName,
} from "./reading";

/**
 * How far the bullet must read from the field behind it, as a Euclidean RGB
 * distance out of the `441` an RGB cube is across, averaged over everything it
 * painted.
 *
 * The case's figure, since the specification states the rule and leaves the
 * palette to the build: `40` is about a tenth of the space, which is what this
 * checklist calls the least a player reads at a glance —
 * `specs/overview.md`'s legibility table asks that "a bullet reads apart from the
 * field along the lane it is traveling".
 */
const DISTINCT_MIN = 40;

/**
 * How closely a blitted source would have to agree with a seeded sprite to count
 * as one of them, as a fraction of the `SPRITE_SIZE` (`64`) square's `4096`
 * places.
 *
 * The same `0.99` this checklist's five silhouette points call a match, so "a
 * seeded frame was drawn here" means the same thing in every point of the group.
 */
const AGREE_MIN = 0.99;

/**
 * How far from the bullet a blit counts as drawn ON it, in logical units.
 *
 * The bullet's own drawn height, so a seeded frame drawn a whole bullet off
 * centre is still caught. On this posed field nothing else is drawn within
 * hundreds of units of the box, so a wider reach costs nothing and only makes
 * the negative half harder to slip past.
 */
const SPRITE_NEAR = PLAYER_BULLET_H;

/** Where the shot is put: inside the play field, clear of the ship's lane. */
const FIRED_AT = { x: 400, y: 400 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("paints a bullet in flight with no seeded frame drawn on it", async () => {
  startPosed(h);
  h.debug.addPlayerBullet(FIRED_AT.x, FIRED_AT.y, "cyan");
  const added = lastBullet(h.snapshot());

  // One frame of the build's own update, recorded: the bullet is drawn wherever
  // that update carried it.
  const blits = await blitsOfFrame(h);
  const flying = bulletOf(h.snapshot(), added.id);
  const at = { x: flying.x, y: flying.y };
  const box = boxOf(at.x, at.y, PLAYER_BULLET_W, PLAYER_BULLET_H);
  const drawn = readRegion(h, box);

  // A bullet drawn in flight.
  captureStill(h, "bullet");

  // The same box of the same field with no bullet in it: the control every place
  // the bullet painted is held against.
  h.debug.clearPlayerBullets();
  await h.advance(1);
  const bare = readRegion(h, box);

  const apart = apartFromField(bare, drawn);
  assertGreaterThanOrEqual(
    apart.distance,
    DISTINCT_MIN,
    `the bullet to paint its PLAYER_BULLET_W (${PLAYER_BULLET_W}) by ` +
      `PLAYER_BULLET_H (${PLAYER_BULLET_H}) box at least ${DISTINCT_MIN} of ` +
      `441 from the field behind it, averaged over the ${apart.samples} ` +
      `places it painted (specs/overview.md: a bullet reads apart from the ` +
      `field along the lane it is travelling)`,
  );

  const near = blitsNear(blits, at, SPRITE_NEAR);
  const seeded = Math.max(
    0,
    ...near.map((blit) =>
      Math.max(
        ...(Object.keys(SPRITES) as SpriteName[]).map(
          (name) => blit.agreement[name],
        ),
      ),
    ),
  );
  assertLessThan(
    seeded,
    AGREE_MIN,
    `no source carrying one of the four seeded sprites' silhouettes to be ` +
      `blitted within ${SPRITE_NEAR} units of the bullet at ` +
      `(${at.x.toFixed(0)}, ${at.y.toFixed(0)}) (specs/assets.md: no seeded ` +
      `file covers a bullet — every bullet is drawn in code); what was ` +
      `blitted there was ${describeBlits(near)}`,
  );
});
