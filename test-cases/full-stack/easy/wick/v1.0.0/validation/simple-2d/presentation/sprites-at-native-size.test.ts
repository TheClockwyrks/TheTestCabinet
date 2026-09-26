// presentation/sprites-at-native-size — a produced sprite covers exactly as
// many stage units as it has pixels.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The sprites"): "Every
// sprite is pixel art drawn at one unit per pixel on a transparent,
// straight-alpha canvas of exactly the size its row states, so a sprite 24
// pixels wide stands 24 units wide in the world". Its table gives each canvas:
// the lamplighter's idle sprite "24 x 32", a common enemy's frames "twice its
// radius in ENEMIES, square: 20 for moth", and the gems "8 x 8, 12 x 12,
// 16 x 16". The same file states the world side of it: "The simulation reads no
// image: a sprite's size in the world is the figure this file states".
//
// THE WORLD. An isolated playing run (`isolate`): no weapon held, every driver
// switch off, and the lamplighter standing still, so the idle sprite is the one
// drawn. A moth and a large gem are placed clear of the lamplighter and of each
// other, the gem beyond PICKUP_RADIUS (48) so it is never attracted or
// collected out from under the frame.
//
// WHAT IS READ. One frame's blits, and the box each of the three covered in
// logical stage units. The canvas fit is one device pixel to one unit here, so
// a build that drew a sprite at any scale of its own reads a box of a different
// size.
//
// TOLERANCE. DRAWN_EXTENT_TOLERANCE (2 units), twice the case's
// DRAWN_POINT_TOLERANCE because an extent is the difference of two edges a
// build may snap to whole device pixels. The nearest wrong size a build could
// draw is a scale of one and a half, which is 4 units out on the smallest of
// the three.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import {
  GEM_PATHS,
  GEM_SPRITE_SIZES,
  LAMPLIGHTER_IDLE_PATH,
  LAMPLIGHTER_SPRITE_HEIGHT,
  LAMPLIGHTER_SPRITE_WIDTH,
  enemySpriteSize,
} from "../constants";
import {
  blitBoxOnStage,
  captureStill,
  createHarness,
  isolate,
  spawnEnemyAt,
  spawnGemAt,
  type Harness,
} from "../harness";
import {
  DRAWN_EXTENT_TOLERANCE,
  drawnFile,
  drawnUnder,
  enemyDir,
} from "./drawn";

/** Where the moth and the gem stand: clear of the lamplighter and of each other. */
const MOTH_AT = { x: 300, y: -100 };
const GEM_AT = { x: -300, y: 100 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the lamplighter, a moth, and a large gem at their produced sizes", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the frame is drawn on");
  spawnEnemyAt(h, "moth", MOTH_AT.x, MOTH_AT.y);
  spawnGemAt(h, "large", GEM_AT.x, GEM_AT.y);

  const blits = await h.frameBlits();
  captureStill(h, "native");

  const sized: ReadonlyArray<{
    what: string;
    box: { w: number; h: number };
    width: number;
    height: number;
  }> = [
    {
      what: `the lamplighter's ${LAMPLIGHTER_IDLE_PATH}`,
      box: blitBoxOnStage(
        h,
        drawnFile(blits, LAMPLIGHTER_IDLE_PATH, "lamplighter"),
      ),
      width: LAMPLIGHTER_SPRITE_WIDTH,
      height: LAMPLIGHTER_SPRITE_HEIGHT,
    },
    {
      what: "a moth's walk frame",
      box: blitBoxOnStage(h, drawnUnder(blits, enemyDir("moth"), "moth")),
      width: enemySpriteSize("moth"),
      height: enemySpriteSize("moth"),
    },
    {
      what: `the large gem's ${GEM_PATHS.large}`,
      box: blitBoxOnStage(h, drawnFile(blits, GEM_PATHS.large, "large gem")),
      width: GEM_SPRITE_SIZES.large,
      height: GEM_SPRITE_SIZES.large,
    },
  ];

  for (const sprite of sized) {
    assertWithin(
      sprite.box.w,
      sprite.width,
      DRAWN_EXTENT_TOLERANCE,
      `the stage units ${sprite.what} covered across`,
    );
    assertWithin(
      sprite.box.h,
      sprite.height,
      DRAWN_EXTENT_TOLERANCE,
      `the stage units ${sprite.what} covered down`,
    );
  }
});
