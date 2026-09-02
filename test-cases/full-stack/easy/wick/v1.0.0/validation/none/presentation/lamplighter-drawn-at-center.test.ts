// presentation/lamplighter-drawn-at-center — the lamplighter's sprite is drawn at
// the stage centre on every playing frame, wherever the lamplighter stands.
//
// THE REQUIREMENT. `specs/world.md` — "The camera and the view": "The camera is
// centered on the lamplighter at all times. A world point `(wx, wy)` is drawn at
// the stage position `(wx - player.x + STAGE_CX, wy - player.y + STAGE_CY)`, with
// `STAGE_CX` (`640`) and `STAGE_CY` (`360`) the stage center, so the lamplighter
// is always drawn at the center of the stage." `specs/ui.md` says the same of the
// screen: "The lamplighter is drawn at the stage center `(STAGE_CX, STAGE_CY)`
// (`640, 360`)".
//
// WHY THE WORLD IS POSED AT SEVERAL POSITIONS. The requirement is that the
// drawing is INDEPENDENT of where the lamplighter is, so a build that drew the
// lamplighter at its world position would pass a reading taken at the origin
// alone, where the two coincide. Three positions are posed: the origin, a point
// in the first quadrant, and one far out in the third, none of them a multiple of
// the ground's tile.
//
// WHAT IS READ. The frame's image draws, kept to the ones whose source is the
// produced lamplighter sprite `specs/assets.md` names — `idle.png` while the
// lamplighter is still, which is what every tick here leaves — and the drawn
// centre of the one that lands. The whole world is emptied first and every
// faculty held, so nothing else is on the field and the only 24 x 32 sprite the
// frame can draw is the lamplighter's.
//
// THE TOLERANCE. `BLIT_TOL`, one logical unit, which is one device pixel at the
// harness's fit: a build is free to round a fractional world position to the
// pixel grid before it blits. The figure itself is exact.

import { afterEach, beforeEach, it } from "vitest";
import { BLIT_TOL, LAMPLIGHTER_IDLE, STAGE_CX, STAGE_CY } from "../constants";
import { assertNear } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
import { oneDrawOf } from "./readouts";
import { primeSources } from "./sources";

/** Where the lamplighter is posed, none of them a multiple of the tile grid. */
const POSITIONS = [
  { x: 0, y: 0 },
  { x: 517, y: 233 },
  { x: -1234, y: -987 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the lamplighter at the stage centre wherever it stands", async () => {
  await isolate(h);
  await primeSources(h, [LAMPLIGHTER_IDLE]);

  for (const at of POSITIONS) {
    await h.debug.setPlayerPosition(at.x, at.y);
    await h.step(1);
    const found = await oneDrawOf(
      h,
      await h.lastCalls(),
      [LAMPLIGHTER_IDLE],
      "the produced lamplighter sprite",
    );
    assertNear(
      found.draw.cx,
      STAGE_CX,
      BLIT_TOL,
      `the stage x the lamplighter was drawn at, standing at world ` +
        `(${at.x}, ${at.y}) (specs/world.md)`,
    );
    assertNear(
      found.draw.cy,
      STAGE_CY,
      BLIT_TOL,
      `the stage y the lamplighter was drawn at, standing at world ` +
        `(${at.x}, ${at.y}) (specs/world.md)`,
    );
  }

  await captureStill(h, "center");
});
