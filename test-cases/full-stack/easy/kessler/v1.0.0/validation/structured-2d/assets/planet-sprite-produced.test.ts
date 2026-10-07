// assets/planet-sprite-produced — the planet sprite is on disk, on its
// 160-pixel canvas, with its disc filling the 140-pixel footprint.
//
// WHAT THE SPECIFICATION FIXES. `specs/assets.md` puts the planet at
// `assets/sprites/planet.png`, produced with `draw` on a `160 x 160` canvas,
// and fixes the one figure inside it: "The planet sprite is drawn centered on
// the stage center, its disc 140 pixels across on the 160-pixel canvas, so the
// disc fills the planet's footprint and the margin is free for atmosphere or
// glow." The path, the canvas, and paint across the disc footprint are what
// this reads: the footprint is sampled two pixels inside its rim (so the
// drawing tool's anti-aliasing never decides the read) and must carry paint
// over at least `DISC_MIN_SHARE` of its pixels.
//
// WHAT IT DELIBERATELY DOES NOT READ. Whether the planet "reads as a planet at
// a glance rather than as a flat disc" is `specs/assets.md`'s art bar and the
// presentation domain's aesthetic rating; whether the game draws the sprite at
// the stage center belongs to the field's own points; and transparency of the
// margin is `assets/sprites-on-transparent-ground`.
//
// HOW THE FILE IS READ. Off the repository the build produced, at the path
// `specs/assets.md` fixes, and decoded by the canvas the engine already runs on
// rather than by a decoder written here — see `assets/sprites.ts` for why. The evidence is a picture of
// the file itself, since this point drives no game.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, fail } from "../assert";
import { PLANET_SPRITE_SIZE } from "../constants";
import { captureStill, openHarness, type Harness } from "../harness";
import {
  decodeSprite,
  DISC_MIN_SHARE,
  discPaintShare,
  PLANET_FILE,
  showSpriteFiles,
} from "./sprites";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("ships the planet sprite, 160 x 160, painted across its disc", async () => {
  const { sprite, reason } = await decodeSprite(PLANET_FILE);
  await showSpriteFiles(h, [PLANET_FILE]);
  captureStill(h, "sprite");

  if (sprite === null) {
    fail(`a decodable image at ${PLANET_FILE}`, reason);
  }
  if (
    sprite.width !== PLANET_SPRITE_SIZE ||
    sprite.height !== PLANET_SPRITE_SIZE
  ) {
    fail(
      `${PLANET_FILE} at ${PLANET_SPRITE_SIZE} x ${PLANET_SPRITE_SIZE}`,
      `${sprite.width} x ${sprite.height}`,
    );
  }
  assertGreaterThanOrEqual(
    discPaintShare(sprite),
    DISC_MIN_SHARE,
    `the share of the 140-pixel disc footprint of ${PLANET_FILE} carrying paint`,
  );
});
