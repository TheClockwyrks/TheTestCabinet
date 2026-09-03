// assets/gem-sprites-produced — the three gem tiers are committed sprites,
// each on the square its tier fixes, each carrying paint.
//
// WHAT THIS DECIDES. Three files: `assets/sprites/gems/small.png`,
// `medium.png` and `large.png` are committed, decode, sit on exactly
// `8 x 8`, `12 x 12` and `16 x 16`, and each carries non-transparent paint.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The sprites"): the row
// "Gems" puts them at "`assets/sprites/gems/small.png`, `medium.png`,
// `large.png`", produced with `draw`, `1` frame each, on "`8 x 8`,
// `12 x 12`, `16 x 16`", and the paragraph above it fixes each canvas
// exactly. `GEM_PATHS` and `GEM_SPRITE_SIZES` in `src/constants.ts` are those
// paths and those squares.
//
// WHY THE THREE SQUARES ARE READ SEPARATELY. The tiers differ by size before
// they differ by anything else — specs/assets.md: "The three gem tiers are
// told apart by size and form" — so the tier a file belongs to is decided by
// the square it is drawn on, and a set drawn all at one size fails here.
//
// WHAT IT DELIBERATELY DOES NOT READ. Whether the three read as three tiers
// at a glance is the art bar and the presentation domain's aesthetic rating;
// which tier an enemy drops, and what each is worth, is the progression
// points' business.
//
// WHY NO WORLD IS POSED. This point is about FILES rather than about a frame,
// so the game is never driven. A harness is opened only to own the canvas the
// evidence picture is painted on.
//
// THE TOLERANCE. Each canvas is exact, because the specification states it
// exactly. The paint floor is `PAINT_MIN_SHARE`, one pixel in a thousand,
// which on the smallest of the three is one pixel of its sixty-four.

import { afterEach, beforeEach, it } from "vitest";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  assertProduced,
  GEM_SPRITES,
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

it("commits the three gems as painted 8, 12 and 16 pixel sprites", async () => {
  const reads = await readSprites(GEM_SPRITES);
  await showSprites(h, GEM_SPRITES);
  captureStill(h, "gems");

  assertProduced(reads);
});
