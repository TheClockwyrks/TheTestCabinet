// presentation/lamplighter-drawn-at-center — the lamplighter's sprite lands on
// the stage centre on every playing frame, wherever it stands in the world.
//
// WHERE THE FIGURES COME FROM. `specs/ui.md`, "`playing`": "The lamplighter is
// drawn at the stage center `(STAGE_CX, STAGE_CY)` (`640, 360`)".
// `specs/world.md`, "The camera and the view", says the same thing as the
// camera rule: "A world point `(wx, wy)` is drawn at the stage position
// `(wx - player.x + STAGE_CX, wy - player.y + STAGE_CY)` ... so the lamplighter
// is always drawn at the center of the stage", and `specs/assets.md` has every
// sprite "drawn centered on the thing it depicts". So the sprite's CENTRE is
// owed the stage centre, whatever `player.x` and `player.y` hold.
//
// THE BOUND. `SPRITE_TOL` (2 device pixels). The harness opens at the stage's
// own `1280 x 720`, where the engine's fit is the identity and one device pixel
// is one stage unit, so a build that centres the sprite lands at zero and one
// that rounds its destination rectangle to whole pixels lands within half a
// unit. A build that drew the lamplighter at its WORLD position instead sits
// hundreds of units away at three of the four poses.
//
// THE WORLD, AND WHY. An isolated world holding nothing at all, with the
// lamplighter posed to four positions in turn through `setPlayerPosition`,
// which `specs/instrumentation.md` says "Sets the lamplighter's center to
// `(x, y)`. Nothing else moves". The origin is the position a run starts at,
// where a build that ignores the camera passes by accident, so the other three
// are far from it and off both axes, including one a long way outside the first
// view. No key is held, so `specs/assets.md` has the idle sprite drawn on every
// one of them.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { STAGE_CX, STAGE_CY } from "../constants";
import {
  blitsNearStage,
  captureStill,
  createHarness,
  isolate,
  type Harness,
} from "../harness";
import { LAMPLIGHTER_FILES, SPRITE_TOL } from "./sprites";

/** Where the lamplighter is posed. The origin first, then three far from it. */
const POSES: readonly { x: number; y: number }[] = [
  { x: 0, y: 0 },
  { x: 317.5, y: -204.25 },
  { x: -1200, y: 860 },
  { x: 5000, y: -5000 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws the lamplighter on the stage centre from any world position", async () => {
  isolate(h);

  for (const pose of POSES) {
    h.debug.setPlayerPosition(pose.x, pose.y);
    const blits = await h.frameBlits();
    captureStill(h, "center");
    const drawn = blitsNearStage(
      h,
      blits,
      STAGE_CX,
      STAGE_CY,
      SPRITE_TOL,
    ).filter((blit) => LAMPLIGHTER_FILES.includes(blit.id));
    assertGreaterThan(
      drawn.length,
      0,
      `a produced lamplighter sprite centred on stage (${STAGE_CX}, ` +
        `${STAGE_CY}) while the lamplighter stands at (${pose.x}, ${pose.y})`,
    );
  }
});
