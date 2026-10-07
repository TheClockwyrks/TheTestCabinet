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
// pass it — so each posed bullet is also read on the pixels: it must paint at
// least one place of the box it occupies that the same box of the same
// field does not carry without it. Together they say what the item claims:
// something is drawn there, and it is not one of the seeded sprites.
//
// A BULLET OF EACH BAND IS POSED. `specs/bands.md` gives the ship's cannon two
// band states and nothing else in this group reads a bullet, so a build that
// draws one band's shot and leaves the other blank is caught here rather than
// nowhere. Both are read in one frame, so the point declares one still.
//
// NOTHING ABOUT HOW A BULLET LOOKS IS ASSERTED. `specs/overview.md` fixes no
// palette, so how the build's bullets read against the field it chose is the
// reviewer's rating. What is graded here is presence and the source behind it.
//
// WHAT "IN CODE" IS NOT TAKEN TO MEAN. `specs/assets.md` says only that no seeded
// file covers a bullet; it does not forbid a build from pre-rendering a shape of
// its own onto a bitmap and blitting that, which is an ordinary way to draw a
// glow once instead of per frame. So the negative half asks whether a SEEDED
// FRAME was drawn there — whether a source carrying one of the four seeded
// silhouettes was blitted on the bullet — rather than whether any bitmap was.
//
// THE BULLETS ARE REALLY IN FLIGHT. Each is added through the surface and the
// game's own update is run, so it carries the velocity the build gave it and is
// drawn wherever that update put it; the box read is the one the snapshot
// reports it at, so nothing here freezes it or assumes how far it travelled.
// `specs/ship.md` fixes the drawn size, `PLAYER_BULLET_W` (`4`) by
// `PLAYER_BULLET_H` (`16`), and that box is what is read.
//
// NOTHING ELSE IS ON THE FIELD. `startPosed` leaves no drone, no other bullet and
// no burst, and both shots stand two hundred units clear of the ship, so the
// only draw near either box is that bullet's own and the fighter blitted on
// the hull is not among the blits considered.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThan, fail } from "../assert";
import { PLAYER_BULLET_H, PLAYER_BULLET_W, SPRITES } from "../constants";
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
  blitsNear,
  blitsOfFrame,
  boxOf,
  describeBlits,
  paintedCount,
  type SpriteName,
} from "./reading";

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

/** Where the two shots are put: in the play field, clear of the ship's lane. */
const CYAN_AT = { x: 400, y: 400 } as const;
const MAGENTA_AT = { x: 480, y: 400 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("paints a bullet of each band with no seeded frame drawn on it", async () => {
  startPosed(h);
  h.debug.addPlayerBullet(CYAN_AT.x, CYAN_AT.y, "cyan");
  const cyanAdded = lastBullet(h.snapshot());
  h.debug.addPlayerBullet(MAGENTA_AT.x, MAGENTA_AT.y, "magenta");
  const magentaAdded = lastBullet(h.snapshot());
  if (magentaAdded.id === cyanAdded.id) {
    fail(
      "addPlayerBullet to append a second, magenta bullet to the roster " +
        "(specs/instrumentation.md)",
      `the roster still held only bullet ${cyanAdded.id}`,
    );
  }

  // One frame of the build's own update, recorded: each bullet is drawn wherever
  // that update carried it.
  const blits = await blitsOfFrame(h);
  const flying = h.snapshot();
  const shots = [
    { band: "cyan", bullet: bulletOf(flying, cyanAdded.id) },
    { band: "magenta", bullet: bulletOf(flying, magentaAdded.id) },
  ];
  const boxes = shots.map(({ bullet }) =>
    boxOf(bullet.x, bullet.y, PLAYER_BULLET_W, PLAYER_BULLET_H),
  );
  const drawn = boxes.map((box) => readRegion(h, box));

  // A bullet of each band drawn in flight.
  captureStill(h, "bullet");

  // The same boxes of the same field with no bullet in them: the control every
  // place a bullet painted is held against.
  h.debug.clearPlayerBullets();
  await h.advance(1);
  const bare = boxes.map((box) => readRegion(h, box));

  for (let i = 0; i < shots.length; i += 1) {
    const { band, bullet } = shots[i];
    const at = { x: bullet.x, y: bullet.y };
    assertGreaterThan(
      paintedCount(bare[i], drawn[i]),
      0,
      `the ${band} bullet to paint at least one place of its ` +
        `PLAYER_BULLET_W (${PLAYER_BULLET_W}) by PLAYER_BULLET_H ` +
        `(${PLAYER_BULLET_H}) box that the same box of the same field does ` +
        `not carry without it (specs/assets.md: every bullet, the player's ` +
        `and the drones' alike, is drawn in code)`,
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
        `blitted within ${SPRITE_NEAR} units of the ${band} bullet at ` +
        `(${at.x.toFixed(0)}, ${at.y.toFixed(0)}) (specs/assets.md: no seeded ` +
        `file covers a bullet — every bullet is drawn in code); what was ` +
        `blitted there was ${describeBlits(near)}`,
    );
  }
});
