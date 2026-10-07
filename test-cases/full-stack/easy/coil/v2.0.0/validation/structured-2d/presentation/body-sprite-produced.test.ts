// presentation/body-sprite-produced — the straight body sprite is on disk, at the
// size a cell is, and carries paint.
//
// WHAT THE SPECIFICATION FIXES. `specs/assets.md` puts the straight body sprite at
// `assets/snake/body.png`, produced with `draw`, authored as a horizontal run,
// and it holds every produced sprite to one shape: "pixel art on a transparent,
// straight-alpha canvas of `CELL x CELL` (`32 x 32`), so one sprite covers
// exactly one board cell". The path, the square, and a drawn sprite rather than
// an empty canvas are what this reads.
//
// WHAT IT DELIBERATELY DOES NOT READ. What the sprite looks like, which is the
// presentation domain's aesthetic rating; that it differs from the other two,
// which is `presentation/sprites-distinct`; and whether the build ever paints
// a cell with it, which is `presentation/body-drawn-from-sprite`.
//
// HOW THE FILE IS READ. Off the repository the build produced, at the path
// `specs/assets.md` fixes, and decoded by the canvas rather than by a reader
// written here — see `presentation/sprites.ts` for why. The evidence is a
// picture of the file itself, since this point drives no game.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, fail } from "../assert";
import { CELL, SPRITE_PATHS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  decodeSprite,
  isCellSized,
  paintShare,
  showSpriteFiles,
} from "./sprites";

/** The path `specs/assets.md` fixes for the straight body sprite. */
const FILE = `assets/${SPRITE_PATHS.body}`;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("ships a painted cell-sized straight body sprite", async () => {
  const { sprite, reason } = await decodeSprite(FILE);
  await showSpriteFiles(h, [FILE]);
  captureStill(h, "sprite");

  if (sprite === null) {
    fail(`a decodable image at ${FILE}`, reason);
  }
  if (!isCellSized(sprite)) {
    fail(
      `${FILE} at CELL x CELL (${CELL} x ${CELL})`,
      `${sprite.width} x ${sprite.height}`,
    );
  }
  assertGreaterThan(
    paintShare(sprite),
    0,
    `the share of ${FILE} carrying paint`,
  );
});
