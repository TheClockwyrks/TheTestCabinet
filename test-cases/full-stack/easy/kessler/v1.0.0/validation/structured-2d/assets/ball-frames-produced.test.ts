// assets/ball-frames-produced — the ball sheet's six frames are on disk as
// separate files, each on its 24-pixel canvas, and each carries paint.
//
// WHAT THE SPECIFICATION FIXES. `specs/assets.md` puts the ball's spin at
// `assets/sprites/ball/0.png` to `5.png`, "24 x 24 per frame", and states the
// sheet's shape: "Six frames, one PNG per frame, produced with `draw-sheet`
// and emitted as separate files rather than as regions of one image", each on
// a transparent, straight-alpha canvas drawn at native size. The six paths,
// the square, and a drawn frame rather than an empty one are what this reads.
//
// WHAT IT DELIBERATELY DOES NOT READ. That the six differ from one another is
// `assets/ball-frames-distinct`; whether the frames "read as one continuous
// spin rather than a flicker" is the art bar and the presentation domain's
// aesthetic rating; and that every ball is drawn from the sheet at one frame
// per 5 ticks belongs to the ball's own presentation points.
//
// HOW A FILE IS READ. Off the repository the build produced, at the paths
// `specs/assets.md` fixes, and decoded by the canvas the engine already runs on
// rather than by a decoder written here — see `assets/sprites.ts` for why. The evidence is a picture of
// the six files themselves, since this point drives no game.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual, fail } from "../assert";
import { BALL_SPIN_FRAMES, BALL_SPRITE_SIZE } from "../constants";
import { captureStill, openHarness, type Harness } from "../harness";
import {
  BALL_FILES,
  decodeSprites,
  PAINT_MIN_SHARE,
  paintShare,
  showSpriteFiles,
} from "./sprites";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("ships six ball frames, each a painted 24 x 24 file of its own", async () => {
  const read = await decodeSprites(BALL_FILES);
  await showSpriteFiles(h, BALL_FILES);
  captureStill(h, "sheet");

  assertEqual(
    BALL_FILES.length,
    BALL_SPIN_FRAMES,
    "ball frames the sheet declares",
  );

  for (let frame = 0; frame < BALL_FILES.length; frame += 1) {
    const file = BALL_FILES[frame];
    const { sprite, reason } = read[frame];
    if (sprite === null) {
      fail(`a decodable image at ${file}`, reason);
    }
    if (
      sprite.width !== BALL_SPRITE_SIZE ||
      sprite.height !== BALL_SPRITE_SIZE
    ) {
      fail(
        `${file} at ${BALL_SPRITE_SIZE} x ${BALL_SPRITE_SIZE}`,
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
