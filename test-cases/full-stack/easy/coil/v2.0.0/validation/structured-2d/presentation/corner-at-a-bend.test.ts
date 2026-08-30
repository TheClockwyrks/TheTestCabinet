// presentation/corner-at-a-bend — a bend is painted with a different sprite from
// the straight run leading into it.
//
// WHAT THE SPECIFICATION FIXES. `specs/assets.md` splits the body by the shape
// of the cell: "a body cell whose two neighbors lie opposite each other" takes
// the straight sprite, "a body cell whose two neighbors lie perpendicular to each
// other" takes the corner sprite, and the two are separate produced files with
// separate authored facings. It states what that is for: "a body cell is never
// drawn as a bare square, and a turning snake reads as one continuous coil rather
// than as a staircase."
//
// WHAT IS READ, AND WHAT IS NOT. That the image painted on the bend is not the
// image painted on the straight. The harness names a blit's source by the
// produced file its bytes were served from, so two blits carry the same identity
// exactly when they painted the same file, and a build that loaded one file into
// two images still reads as one sprite. It is deliberately NOT read that the bend
// took `assets/snake/corner.png` by name: `specs/assets.md` fixes the files, but
// how a build names and orders the images it loads them into is the build's, and
// the file's own existence is `presentation/corner-sprite-produced`.
//
// THE CHAIN THIS POSES. Head at `(10, 8)` facing right, then `(9, 8)`, `(8, 8)`,
// `(8, 9)`, `(8, 10)`. Each cell after the first is orthogonally adjacent to the
// one before it and none repeats, which is what `setSnake` accepts, and it is a
// path the snake could have travelled: down column 8 and then east along row 8.
//   - `(9, 8)` is the STRAIGHT case — its neighbours `(10, 8)` and `(8, 8)` lie
//     opposite each other along the row.
//   - `(8, 8)` is the BEND — its neighbours `(9, 8)` and `(8, 9)` lie
//     perpendicular.
//   - `(8, 10)` is the last cell, which takes the tail sprite, so it is left out
//     of the comparison.
//
// THE WORLD THIS POSES. The chain alone: the pellet cleared, the obstacle course
// cleared (so the same cells are free under either mode), travel switched off so
// the shape stays the shape that was posed.

import { afterEach, beforeEach, it } from "vitest";
import { assertNotEqual, assertNotNull } from "../assert";
import {
  captureStill,
  createHarness,
  poseScene,
  spriteOnCell,
  type Cell,
  type Harness,
} from "../harness";

/** A chain that runs east along row 8 and turns south down column 8. */
const CHAIN: readonly Cell[] = [
  { col: 10, row: 8 },
  { col: 9, row: 8 },
  { col: 8, row: 8 },
  { col: 8, row: 9 },
  { col: 8, row: 10 },
];

/** Index 1: two neighbours opposite each other along the row. */
const STRAIGHT = CHAIN[1];

/** Index 2: two neighbours perpendicular to each other. */
const BEND = CHAIN[2];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("paints the bend cell with a different sprite from the straight cell", async () => {
  poseScene(h, {
    snake: CHAIN,
    dir: "right",
    pellet: null,
    travel: false,
  });

  const blits = await h.frameBlits();
  captureStill(h, "bend");

  const onBend = spriteOnCell(h, blits, BEND.col, BEND.row);
  const onStraight = spriteOnCell(h, blits, STRAIGHT.col, STRAIGHT.row);
  assertNotNull(onBend, "the sprite painted on the bend cell");
  assertNotNull(onStraight, "the sprite painted on the straight cell");

  assertNotEqual(
    onBend,
    onStraight,
    "the sprite painted on the bend cell, against the one on the straight cell",
  );
});
