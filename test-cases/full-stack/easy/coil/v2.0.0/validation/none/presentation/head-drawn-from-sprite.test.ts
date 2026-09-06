// presentation/head-drawn-from-sprite — the head cell is painted with a bitmap,
// not with a shape drawn in code.
//
// WHAT THE SPECIFICATION FIXES. `specs/assets.md` opens with it: "the snake is
// drawn from produced sprites rather than from shapes drawn in code", and its
// table of which cell picks which sprite gives the head "the head sheet's
// current frame, turned to the snake's direction". The same file's closing table
// lists everything that stays drawn in code — the field, the ruling, the border,
// the obstacles, the pellet, the HUD, the screens, the overlay — and the snake is
// not on it.
//
// WHAT IS READ. Whether an image draw landed on the head's cell. The harness
// reads `drawImage` — the one door a bitmap reaches a 2D canvas through — off
// the frame's recorded operations, and maps the destination rectangle through
// the transform in force at the call, so a build that translates to the cell and
// blits at the origin is read at the cell. Nothing here asks WHICH file was painted: `specs/assets.md` fixes
// the files but leaves a build free to name and order the images it loads them
// into, and the head's own sheet is decided by `presentation/head-frames-*`.
//
// THE WORLD THIS POSES. A chain and nothing else — the pellet cleared, the
// obstacle course cleared, travel switched off — so the only thing that could
// have blitted on the head's cell is the head.

import { afterEach, beforeEach, it } from "vitest";
import { assertNotNull } from "../assert";
import {
  captureStill,
  chainFrom,
  createHarness,
  HOME_HEAD,
  poseScene,
  spriteOnCell,
  type Harness,
} from "../harness";

/** Head, two straight body cells, and the tail: a chain as it is in play. */
const LENGTH = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("paints the head cell with an image draw", async () => {
  await poseScene(h, {
    snake: chainFrom(HOME_HEAD, "right", LENGTH),
    dir: "right",
    pellet: null,
    travel: false,
  });

  const blits = await h.frameBlits();
  await captureStill(h, "head");

  assertNotNull(
    spriteOnCell(h, blits, HOME_HEAD.col, HOME_HEAD.row),
    "the sprite an image draw painted on the head cell",
  );
});
