// Wick — assets/ground-tile-produced: the ground tile is a committed file on
// its stated canvas, carrying paint.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/assets.md (The sprites): "Ground tile |
//     `assets/sprites/ground.png` | `draw` | `1` | `64 x 64`", under "of exactly
//     the size its row states".
//   - specs/assets.md (The sprites): "The ground tile sits flush against itself
//     on all four sides, since the ground is that tile repeated across the
//     world", so the canvas is the repeat and its size is what the repeat steps
//     by.
//   - specs/assets.md (What stays drawn in code): "The ground, as the produced
//     tile repeated in world space", so the file is the only art the ground has.
//   - `constants.ts` carries the path and the square as `GROUND_TILE_PATH` and
//     `GROUND_TILE_SIZE`.
//
// WHAT IS READ. The committed file decodes, its canvas is exactly `64 x 64`,
// and at least one of its pixels is not fully transparent.
//
// WHAT IT DELIBERATELY DOES NOT READ. That the tile is drawn repeated in world
// space, and where its corners land, is the world's own presentation point;
// whether the tile reads as ground, and whether its edges join without a visible
// seam, is the art bar the presentation domain's rating judges.
//
// WHY NO NIGHT IS POSED. This point is about a FILE, so nothing is posed and no
// game is driven. The evidence is the tile itself, magnified.
//
// TOLERANCE. None. One exact path, an exact canvas, and a count.

import { it } from "vitest";
import { captureCanvas } from "../harness";
import {
  GROUND_SPRITE,
  assertProduced,
  readSprite,
  sheetOf,
} from "./produced";

it("commits the ground tile at 64 x 64, carrying paint", async () => {
  const read = await readSprite(GROUND_SPRITE);

  captureCanvas(
    await sheetOf([GROUND_SPRITE], { title: "assets/sprites/ground.png" }),
    "ground",
  );

  assertProduced(read);
});
