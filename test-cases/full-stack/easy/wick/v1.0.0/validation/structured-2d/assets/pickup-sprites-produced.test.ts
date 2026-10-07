// assets/pickup-sprites-produced — the three pickup sprites are committed on
// their shared square, each painted, no two the same picture.
//
// WHAT THIS DECIDES. Three files: `assets/sprites/pickups/chest.png`,
// `bread.png` and `draft.png` are committed, decode, sit on exactly
// `24 x 24`, each carries non-transparent paint, and no two of the three are
// the same picture.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The sprites"): the row
// "Pickups" puts them at "`assets/sprites/pickups/chest.png`, `bread.png`,
// `draft.png`", produced with `draw`, `1` frame each, on `24 x 24`, and the
// paragraph above it fixes the canvas exactly. The three differing comes from
// the same table: three kinds are drawn as three sprites, and a player who
// walks over a chest, a loaf, and a draft has to be able to tell which is on
// the ground, which a set drawn as one picture makes impossible. Whether the
// three read as a chest, a loaf and a draft is the art bar and the
// presentation domain's aesthetic rating. `PICKUP_PATHS` and
// `PICKUP_SPRITE_SIZE` in `src/constants.ts` are those paths and that square.
//
// WHY NO WORLD IS POSED. This point is about FILES rather than about a frame,
// so the game is never driven. A harness is opened only to own the canvas the
// evidence picture is painted on.
//
// THE TOLERANCE. The canvas is exact, because the specification states it
// exactly; the paint reading is presence, at least one pixel not clear; and
// two sprites are the same picture within `PIXEL_CHANNEL_EPS`, eight levels
// of 255 per channel.

import { afterEach, beforeEach, it } from "vitest";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  assertNoTwoIdentical,
  assertProduced,
  PICKUP_SPRITES,
  readSprites,
  showSprites,
} from "./produced";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("commits the three pickups as painted 24 x 24 sprites, no two alike", async () => {
  const reads = await readSprites(PICKUP_SPRITES);
  await showSprites(h, PICKUP_SPRITES);
  captureStill(h, "pickups");

  const sprites = assertProduced(reads);
  assertNoTwoIdentical(
    sprites,
    PICKUP_SPRITES.map((sprite) => sprite.path),
  );
});
