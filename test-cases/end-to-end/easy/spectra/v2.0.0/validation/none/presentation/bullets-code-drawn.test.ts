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
// the square it occupies apart from the field behind it. Together they say what
// the item claims: something is drawn there, and it is not one of the seeded
// sprites.
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
// wherever that update put it; the square read is the one the snapshot reports it
// at, so nothing here freezes it or assumes how far it travelled. `specs/ship.md`
// fixes the drawn size, `PLAYER_BULLET_W` (`4`) by `PLAYER_BULLET_H` (`16`), and
// that box is the square read.
//
// NOTHING ELSE IS ON THE FIELD. `startPosed` leaves no drone, no other bullet and
// no burst, and the ship stands four hundred units away down its own lane, so the
// only draw near the square is the bullet's own and the fighter blitted on the
// ship is not among the blits considered.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertLessThan, fail } from "../assert";
import {
  PLAYER_BULLET_H,
  PLAYER_BULLET_W,
  SPRITES,
  type SpriteName,
} from "../constants";
import {
  blitsNear,
  blitsOfFrame,
  captureStill,
  createHarness,
  lastBullet,
  readRegion,
  requireBullet,
  startPosed,
  type Harness,
  type Rect,
} from "../harness";
import { apartFromField, describeBlits } from "./reading";

/**
 * How far the bullet must read from the field behind it, as a Euclidean RGB
 * distance out of the `441` an RGB cube is across, averaged over everything it
 * painted.
 *
 * The case's figure, since the specification states the rule and leaves the
 * palette to the build: `40` is about a tenth of the space, which is what this
 * checklist calls the least a player reads at a glance —
 * `specs/overview.md`'s legibility table asks that "a bullet reads apart from the
 * field along the lane it is travelling".
 */
const DISTINCT_MIN = 40;

/**
 * How closely a blitted source would have to agree with a seeded sprite to count
 * as one of them, as a fraction of the `SPRITE_SIZE` (`64`) square's `4096`
 * places.
 *
 * The same `0.99` this checklist's five silhouette points call a match, so
 * "a seeded frame was drawn here" means the same thing in every point of the
 * group.
 */
const AGREE_MIN = 0.99;

/**
 * How far from the bullet a blit counts as drawn ON it, in logical units.
 *
 * The bullet's own drawn height, so a seeded frame drawn a whole bullet off
 * centre is still caught. On this posed field nothing else is drawn within
 * hundreds of units of the square, so a wider reach costs nothing and only makes
 * the negative half harder to slip past.
 */
const SPRITE_NEAR = PLAYER_BULLET_H;

/** Where the shot is put: inside the play field, clear of the ship's lane. */
const FIRED_AT = { x: 400, y: 400 } as const;

/**
 * The lattice the bullet's box is read on, in logical units.
 *
 * One sample per logical unit, which is one device pixel at this harness's own
 * viewport, so the `4 x 16` box is every one of its `64` pixels.
 */
const READ_STEP = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("paints a bullet in flight with no seeded frame drawn on it", async () => {
  await startPosed(h);
  await h.debug.addPlayerBullet(FIRED_AT.x, FIRED_AT.y, "cyan");
  const added = lastBullet(await h.snapshot());
  if (added === undefined) {
    fail(
      "addPlayerBullet to append a bullet to the roster " +
        "(specs/instrumentation.md)",
      "the bullet roster was still empty after addPlayerBullet",
    );
  }

  // One frame of the build's own update, recorded: the bullet is drawn wherever
  // that update carried it.
  const blits = await blitsOfFrame(h);
  const flying = requireBullet(
    await h.snapshot(),
    added.id,
    "the bullet in flight",
  );
  const at = { x: flying.x, y: flying.y };
  const box: Rect = {
    x: at.x - PLAYER_BULLET_W / 2,
    y: at.y - PLAYER_BULLET_H / 2,
    width: PLAYER_BULLET_W,
    height: PLAYER_BULLET_H,
  };
  const drawn = await readRegion(h, box, READ_STEP);

  // A bullet drawn in flight.
  await captureStill(h, "bullet");

  // The same box of the same field with no bullet in it: the control every place
  // the bullet painted is held against.
  await h.debug.clearPlayerBullets();
  await h.advance(1);
  const bare = await readRegion(h, box, READ_STEP);

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
