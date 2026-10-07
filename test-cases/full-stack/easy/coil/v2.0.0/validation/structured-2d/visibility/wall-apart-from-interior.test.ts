// visibility/wall-apart-from-interior — the border a player must not touch is
// drawn rather than left as bare ground.
//
// WHAT THE SPECIFICATION FIXES. `specs/board.md` makes the wall border one cell
// thick on all four sides and has it "drawn for the whole round", and
// `specs/overview.md` requires that a player read it. The palette is the build's
// and how the border looks is the presentation domain's aesthetic rating, so the
// one thing a check may read off the picture is PRESENCE: whether the build
// painted the wall cells at all.
//
// HOW PRESENCE IS READ. Against the stage outside the board. The border is drawn
// for the whole round and never changes (`specs/board.md`), so there is no frame
// of this build with the board and without its border to compare against; what
// there is instead is ground the board does not cover. `specs/board.md` spans the
// board over x `[BOARD_X, BOARD_X + BOARD_W]`, so a point at x below `BOARD_X` is
// stage the board never reaches, and a build that painted its border renders
// something else on the border itself.
//
// THE WORLD THIS POSES. Nothing but the chain, which cannot be taken off the
// board: the pellet is cleared, the obstacle course is cleared, and the chain is
// laid across the middle of the interior, far from the wall cell sampled. Travel
// is switched off, so nothing moves between the pose and the sample.
//
// WHERE IT SAMPLES. `WALL_CELL` is column `0` at mid height — border at every
// row (`specs/board.md`), and as far from a corner as the board goes, so a build
// that rounds or highlights its corners is read on the run of the border rather
// than on a joint. The point it is read against is halfway between the stage's
// left edge and the board's, at the same height.

import { afterEach, beforeEach, it } from "vitest";
import { assertNotEqual } from "../assert";
import { BOARD_X } from "../constants";
import {
  captureStill,
  cellCenter,
  chainFrom,
  createHarness,
  HOME_HEAD,
  poseScene,
  WALL_CELL,
  type Harness,
  type Rgb,
} from "../harness";

/** A sampled colour as one string, so a failure names the reading plainly. */
function shows(color: Rgb): string {
  return `rgb(${color.r}, ${color.g}, ${color.b})`;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("paints the wall border, over stage the board does not reach", async () => {
  poseScene(h, {
    snake: chainFrom(HOME_HEAD, "right", 3),
    dir: "right",
    pellet: null,
    travel: false,
  });
  await h.advance(1);
  captureStill(h, "scene");

  const middle = cellCenter(WALL_CELL.col, WALL_CELL.row);
  const [wallR, wallG, wallB] = h.pixel(middle.x, middle.y);
  const [groundR, groundG, groundB] = h.pixel(BOARD_X / 2, middle.y);

  assertNotEqual(
    shows({ r: wallR, g: wallG, b: wallB }),
    shows({ r: groundR, g: groundG, b: groundB }),
    "a wall cell's centre, against stage outside the board's own rectangle",
  );
});
