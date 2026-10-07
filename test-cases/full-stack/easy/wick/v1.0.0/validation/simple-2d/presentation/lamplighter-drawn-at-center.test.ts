// presentation/lamplighter-drawn-at-center — the lamplighter's sprite is drawn
// on the stage center whatever the lamplighter's world position.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("playing"): "The lamplighter is
// drawn at the stage center (STAGE_CX, STAGE_CY) (640, 360), facing the way
// facing says." specs/world.md ("The camera and the view") says the same from
// the camera's side: "The camera is centered on the lamplighter at all times
// ... so the lamplighter is always drawn at the center of the stage."
// specs/assets.md fixes what is drawn there and how it is anchored: the idle
// sprite or a walk frame under `sprites/lamplighter/`, and "Each is drawn
// centered on the thing it depicts", so the center of the bitmap the frame
// blitted is the lamplighter's drawn position.
//
// THE WORLD. An isolated playing run (`isolate`): nothing on the field, no
// weapon held, every driver switch off. The lamplighter alone is posed, at
// four world positions in turn, each far from the origin and none of them a
// whole multiple of anything, and one frame is drawn at each.
//
// WHAT IS READ. The center of the last blit of a produced file under
// `sprites/lamplighter/`, in logical stage units, on each of the four frames.
// A build that drew the lamplighter at its world position instead is hundreds
// of units out on three of the four.
//
// TOLERANCE. DRAWN_POINT_TOLERANCE (1 unit), the case's tolerance for a sprite
// a build may snap to whole device pixels.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import {
  DRAWN_POINT_TOLERANCE,
  FIGURE_TOLERANCE,
  STAGE_CX,
  STAGE_CY,
} from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  type Harness,
  type Point,
} from "../harness";
import { LAMPLIGHTER_DIR, drawnCenterUnder } from "./drawn";

/** Where the lamplighter stands for each of the four frames. */
const STANDS: readonly Point[] = [
  { x: 0, y: 0 },
  { x: 617.5, y: -240.25 },
  { x: -1830, y: 4120.75 },
  { x: 33.5, y: -7.125 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the lamplighter on the stage center from every world position", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the frames are drawn on");

  for (const stand of STANDS) {
    h.debug.setPlayerPosition(stand.x, stand.y);
    const placed = h.snapshot();
    assertWithin(
      placed.run.player.x,
      stand.x,
      FIGURE_TOLERANCE,
      `player.x as posed at (${stand.x}, ${stand.y})`,
    );
    assertWithin(
      placed.run.player.y,
      stand.y,
      FIGURE_TOLERANCE,
      `player.y as posed at (${stand.x}, ${stand.y})`,
    );

    const blits = await h.frameBlits();
    captureStill(h, "center");
    const drawn = drawnCenterUnder(h, blits, LAMPLIGHTER_DIR, "lamplighter");
    assertWithin(
      drawn.x,
      STAGE_CX,
      DRAWN_POINT_TOLERANCE,
      `the lamplighter's drawn center x, standing at (${stand.x}, ${stand.y})`,
    );
    assertWithin(
      drawn.y,
      STAGE_CY,
      DRAWN_POINT_TOLERANCE,
      `the lamplighter's drawn center y, standing at (${stand.x}, ${stand.y})`,
    );
  }
});
