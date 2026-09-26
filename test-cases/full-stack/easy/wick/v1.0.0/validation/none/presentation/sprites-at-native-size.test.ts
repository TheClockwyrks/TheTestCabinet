// presentation/sprites-at-native-size — a produced sprite covers as many stage
// units as it has pixels.
//
// THE REQUIREMENT. `specs/assets.md` — "The sprites": "Every sprite is pixel art
// drawn at one unit per pixel on a transparent, straight-alpha canvas of exactly
// the size its row states, so a sprite `24` pixels wide stands `24` units wide in
// the world". The three figures read here are the three that row table states:
// the lamplighter's idle sprite is `24 x 32`, a moth's frame is "twice its radius
// in `ENEMIES`, square", which is `20` for `moth`, and a large gem is `16 x 16`.
//
// WHY THESE THREE. They are the three shapes the rule has to hold across at once:
// a sprite that is not square, a sheet frame whose size is derived from the
// simulation's own figure, and the smallest still sprite the table places on the
// field. A build that fitted every sprite to one box, or that scaled its art to
// the stage rather than drawing it at one unit per pixel, misses at least one of
// them.
//
// WHY THE WORLD IS POSED AS IT IS. An emptied night with every faculty held: the
// moth and the gem are the only things on the field beside the lamplighter, so
// each drawn sprite is unambiguous. The gem stands `200` units from the
// lamplighter, well beyond `pickupRadius` (`48` with no Lure held), so
// `specs/world.md`'s attraction never starts and it stays where it was placed.
//
// WHAT IS READ. The destination extent of each draw, taken as the destination
// rectangle's diagonal over `sqrt(2)` for the two square sprites, because
// `specs/assets.md` leaves a sprite free to be mirrored and a projectile free to
// be turned, and a rotation preserves a diagonal where it does not preserve a
// side. The lamplighter's rectangle is read side by side, since it is not square.
//
// THE TOLERANCE. `BLIT_TOL`, one logical unit, which is one device pixel at the
// harness's fit: a build is free to round a fractional destination to the pixel
// grid. The figures themselves are exact.

import { afterEach, beforeEach, it } from "vitest";
import {
  BLIT_TOL,
  GEM_SIZES,
  LAMPLIGHTER_IDLE,
  LAMPLIGHTER_SIZE,
  gemSprite,
} from "../constants";
import { assertNear } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  stagePoint,
  type Harness,
} from "../harness";
import {
  drawOfNear,
  enemySheet,
  enemySide,
  oneDrawOf,
  squareSide,
} from "./readouts";
import { primeSources } from "./sources";

/** Where the moth and the gem stand, both well clear of the pickup radius. */
const MOTH_AT = { dx: 200, dy: -100 };
const GEM_AT = { dx: -200, dy: 100 };

const MOTH_SHEET = enemySheet("moth");
const LARGE_GEM = gemSprite("large");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws every produced sprite at one unit per pixel", async () => {
  const posed = await isolate(h);
  await primeSources(h, [LAMPLIGHTER_IDLE, LARGE_GEM, ...MOTH_SHEET]);

  const at = posed.run.player;
  await h.debug.spawnEnemy("moth", at.x + MOTH_AT.dx, at.y + MOTH_AT.dy);
  await h.debug.spawnGem("large", at.x + GEM_AT.dx, at.y + GEM_AT.dy);
  const snapshot = await h.step(1);
  const calls = await h.lastCalls();
  await captureStill(h, "native");

  const lamplighter = await oneDrawOf(
    h,
    calls,
    [LAMPLIGHTER_IDLE],
    "the produced lamplighter sprite",
  );
  assertNear(
    Math.abs(lamplighter.draw.dw),
    LAMPLIGHTER_SIZE.width,
    BLIT_TOL,
    "the stage units the lamplighter's 24 x 32 idle sprite covers across " +
      "(specs/assets.md)",
  );
  assertNear(
    Math.abs(lamplighter.draw.dh),
    LAMPLIGHTER_SIZE.height,
    BLIT_TOL,
    "the stage units the lamplighter's 24 x 32 idle sprite covers down " +
      "(specs/assets.md)",
  );

  const moth = snapshot.run.enemies[0]!;
  const mothDraw = await drawOfNear(
    h,
    calls,
    MOTH_SHEET,
    stagePoint(snapshot, moth.x, moth.y),
    "a frame of the moth's produced sheet",
  );
  assertNear(
    squareSide(mothDraw.draw),
    enemySide("moth"),
    BLIT_TOL,
    "the stage units a moth's 20 x 20 sheet frame covers (specs/assets.md)",
  );

  const gem = snapshot.run.gems[0]!;
  const gemDraw = await drawOfNear(
    h,
    calls,
    [LARGE_GEM],
    stagePoint(snapshot, gem.x, gem.y),
    "the produced large gem sprite",
  );
  assertNear(
    squareSide(gemDraw.draw),
    GEM_SIZES.large.width,
    BLIT_TOL,
    "the stage units a 16 x 16 large gem covers (specs/assets.md)",
  );
});
