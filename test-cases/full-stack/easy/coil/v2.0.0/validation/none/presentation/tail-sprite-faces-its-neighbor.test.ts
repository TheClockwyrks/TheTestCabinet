// presentation/tail-sprite-faces-its-neighbor — the tail sprite is authored
// joining on its right edge.
//
// WHAT THE SPECIFICATION FIXES. `specs/assets.md` tabulates each sprite's
// "Authored facing", and the tail's is "Its one neighbor lying to the right". It
// then holds the joins to a standard: "The straight, corner, and tail sprites
// join without a seam or a gap, so a continuous snake looks continuous where two
// cells meet." And it authors every sprite once: each is "authored in the one
// orientation the table names and rotated in quarter turns when it is drawn, so
// no sprite is produced twice for a second direction."
//
// WHY THE FILE IS READ AND NOT THE BOARD. A tail authored backwards and a
// renderer that turns it backwards compose to a correct picture on every frame,
// so no reading of a rendered board can separate them. The two halves are two
// points: this one reads the FILE, and
// `presentation/tail-turned-toward-its-neighbor` reads the turn the renderer drew
// it under. A build that gets one wrong opens a one-cell gap at the end of the
// coil, and this says which half it was.
//
// WHAT IS READ. How many rows of each of the sprite's two vertical edge columns
// carry paint. The right edge is the one the neighbour lies on, so it must be
// reached; the left edge is the free end of the snake, so it must not be reached
// in the same way, or the tail reads as a piece of body running on past the cell
// where the snake ends.
//
// WHAT IS DELIBERATELY NOT READ. How thick the snake is, what the taper looks
// like, or how the tip is shaped: `specs/assets.md` fixes none of them, and they
// are the presentation domain's aesthetic rating. What is read is the one thing
// the table fixes — which edge the piece joins on.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
  fail,
} from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  FREE_MAX_SHARE,
  JOIN_MIN_ROWS,
  decodeSprite,
  edgeRows,
  showSpriteFiles,
} from "./sprites";

/** The path `specs/assets.md` fixes for the tail sprite. */
const FILE = "assets/snake/tail.png";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reaches its right edge, where its one neighbor lies, and not its left", async () => {
  const { sprite, reason } = await decodeSprite(h, FILE);
  await showSpriteFiles(h, [FILE]);
  await captureStill(h, "authored");

  if (sprite === null) {
    fail(`a decodable image at ${FILE}`, reason);
  }

  const joining = edgeRows(sprite, "right");
  const free = edgeRows(sprite, "left");

  assertGreaterThanOrEqual(
    joining,
    JOIN_MIN_ROWS,
    `rows of ${FILE}'s right edge carrying paint, where its one neighbor lies`,
  );
  assertLessThanOrEqual(
    free,
    joining * FREE_MAX_SHARE,
    `rows of ${FILE}'s left edge carrying paint, which is the snake's free end` +
      ` (its right edge carries ${joining})`,
  );
});
