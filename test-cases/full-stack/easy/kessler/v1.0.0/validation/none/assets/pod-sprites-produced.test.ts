// assets/pod-sprites-produced — the five pod sprites are on disk, each on its
// 24-pixel canvas, and each carries paint.
//
// WHAT THE SPECIFICATION FIXES. `specs/assets.md` puts the salvage pods at
// `assets/sprites/pods/widen.png`, `narrow.png`, `multiball.png`, `shield.png`
// and `pierce.png`, produced with `draw`, "24 x 24 each", every one "on a
// transparent, straight-alpha canvas" and drawn at native size. The five
// paths, the square, and a drawn sprite rather than an empty canvas are what
// this reads.
//
// WHAT IT DELIBERATELY DOES NOT READ. That the five differ from one another is
// `assets/pod-sprites-distinct`; whether "the five pod kinds are told apart
// from each other at 24 pixels, in flight, without reading a label" is the art
// bar and the presentation domain's aesthetic rating; and whether the game
// draws a falling pod from its sprite belongs to the pods' own points.
//
// HOW A FILE IS READ. Off the repository the build produced, at the paths
// `specs/assets.md` fixes, and decoded by the browser rather than by a decoder
// written here — see `assets/sprites.ts` for why. The evidence is a picture of
// the five files themselves, since this point drives no game.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, fail } from "../assert";
import { POD_SPRITE_SIZE } from "../constants";
import { captureStill, openHarness, type Harness } from "../harness";
import {
  decodeSprites,
  PAINT_MIN_SHARE,
  paintShare,
  POD_FILES,
  showSpriteFiles,
} from "./sprites";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("ships five pod sprites, each a painted 24 x 24 canvas", async () => {
  const read = await decodeSprites(h, POD_FILES);
  await showSpriteFiles(h, POD_FILES);
  await captureStill(h, "sprites");

  for (let i = 0; i < POD_FILES.length; i += 1) {
    const file = POD_FILES[i];
    const { sprite, reason } = read[i];
    if (sprite === null) {
      fail(`a decodable image at ${file}`, reason);
    }
    if (sprite.width !== POD_SPRITE_SIZE || sprite.height !== POD_SPRITE_SIZE) {
      fail(
        `${file} at ${POD_SPRITE_SIZE} x ${POD_SPRITE_SIZE}`,
        `${sprite.width} x ${sprite.height}`,
      );
    }
    assertGreaterThanOrEqual(
      paintShare(sprite),
      PAINT_MIN_SHARE,
      `the share of ${file} carrying paint`,
    );
  }
});
