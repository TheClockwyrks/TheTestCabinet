// presentation/sprites-at-native-size — a produced sprite covers exactly as
// many stage units as it has pixels.
//
// WHERE THE FIGURES COME FROM. `specs/assets.md`, "The sprites": "Every sprite
// is pixel art drawn at one unit per pixel on a transparent, straight-alpha
// canvas of exactly the size its row states, so a sprite `24` pixels wide
// stands `24` units wide in the world." Its table gives each canvas: the
// lamplighter's idle sprite `24 x 32`, a common enemy's frames "twice its
// radius in `ENEMIES`, square: `20` for `moth`", and the gems "`8 x 8`,
// `12 x 12`, `16 x 16`". The same file states the world's side of it: "The
// simulation reads no image: a sprite's size in the world is the figure this
// file states".
//
// THE BOUND. `NATIVE_TOL` (2 units) on each extent, which is the rounding a
// build that lands its destination rectangle on whole device pixels picks up
// on the two edges an extent spans, doubled. The harness opens at the stage's
// own `1280 x 720`, where the fit is the identity and one device pixel is one
// stage unit, so the reading is in units already. The nearest wrong size a
// build could draw is a scale of one and a quarter, four units out on the
// `16 x 16` gem.
//
// THE WORLD, AND WHY. An isolated world holding nothing but the three things
// read: no weapon, no passive, every driver switch off, and no key held, so
// `specs/assets.md` has the lamplighter drawing its idle sprite. The moth and
// the large gem stand clear of the lamplighter and of each other, the gem far
// beyond `pickupRadius` (`48` with no Lure held), so nothing is attracted or
// collected out from under the frame.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNotNull } from "../assert";
import {
  GEM_PATHS,
  GEM_SPRITE_SIZES,
  LAMPLIGHTER_IDLE_PATH,
  LAMPLIGHTER_SPRITE_HEIGHT,
  LAMPLIGHTER_SPRITE_WIDTH,
  assetFile,
  enemySpriteSize,
} from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  placeEnemy,
  placeGem,
  type Blit,
  type Harness,
} from "../harness";
import { NATIVE_TOL, enemyFiles, lastDrawnFrom, stageBoxOf } from "./sprites";

/** Where the moth and the gem stand: clear of the lamplighter and of each other. */
const MOTH_AT = { x: 300, y: -100 };
const GEM_AT = { x: -300, y: 100 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws the lamplighter, a moth, and a large gem at their produced sizes", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the frame is drawn on");
  placeEnemy(h, "moth", MOTH_AT.x, MOTH_AT.y);
  placeGem(h, "large", GEM_AT.x, GEM_AT.y);

  const blits = await h.frameBlits();
  captureStill(h, "native");
  const { player } = h.snapshot().run;

  const sized: readonly {
    what: string;
    blit: Blit | null;
    width: number;
    height: number;
  }[] = [
    {
      what: `the lamplighter's ${LAMPLIGHTER_IDLE_PATH}`,
      blit: lastDrawnFrom(
        h,
        blits,
        [assetFile(LAMPLIGHTER_IDLE_PATH)],
        player.x,
        player.y,
      ),
      width: LAMPLIGHTER_SPRITE_WIDTH,
      height: LAMPLIGHTER_SPRITE_HEIGHT,
    },
    {
      what: "a moth's walk frame",
      blit: lastDrawnFrom(h, blits, enemyFiles("moth"), MOTH_AT.x, MOTH_AT.y),
      width: enemySpriteSize("moth"),
      height: enemySpriteSize("moth"),
    },
    {
      what: `the large gem's ${GEM_PATHS.large}`,
      blit: lastDrawnFrom(
        h,
        blits,
        [assetFile(GEM_PATHS.large)],
        GEM_AT.x,
        GEM_AT.y,
      ),
      width: GEM_SPRITE_SIZES.large,
      height: GEM_SPRITE_SIZES.large,
    },
  ];

  for (const sprite of sized) {
    assertNotNull(sprite.blit, `${sprite.what}, drawn on the thing it depicts`);
    const box = stageBoxOf(h, sprite.blit as Blit);
    assertNear(
      box.w,
      sprite.width,
      NATIVE_TOL,
      `the stage units ${sprite.what} covered across`,
    );
    assertNear(
      box.h,
      sprite.height,
      NATIVE_TOL,
      `the stage units ${sprite.what} covered down`,
    );
  }
});
