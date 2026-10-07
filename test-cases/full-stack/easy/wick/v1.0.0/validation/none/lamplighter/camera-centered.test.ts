// lamplighter/camera-centered — every frame draws the lamplighter at the stage
// center and every other world point offset from it by the camera formula, so
// when the lamplighter moves the world slides the other way.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("The camera and the view"):
// "The camera is centered on the lamplighter at all times. A world point
// `(wx, wy)` is drawn at the stage position `(wx - player.x + STAGE_CX,
// wy - player.y + STAGE_CY)`, with `STAGE_CX` (`640`) and `STAGE_CY` (`360`) the
// stage center, so the lamplighter is always drawn at the center of the stage",
// "recomputed every tick as the lamplighter moves". specs/ui.md fixes the same
// for the `playing` screen: "every enemy ... inside the view drawn at its world
// position. The lamplighter is drawn at the stage center `(STAGE_CX, STAGE_CY)`
// (`640, 360`)". specs/assets.md fixes what is drawn there: the lamplighter's
// `24 x 32` sprite and a moth's `20 x 20` one, each "drawn centered on the
// thing it depicts" at "one unit per pixel". So on a frame with the lamplighter
// at `(300, -120)` and a moth at `(400, -120)`, a `24 x 32` image is drawn
// centered at `(640, 360)` and a `20 x 20` one at `(740, 360)`; and on every
// later frame the moth's drawn center is `stagePoint` of its world position
// under the lamplighter's position of that frame, which is `(740 - dx, 360)`
// after the lamplighter has moved `dx` right.
//
// THE NIGHT. An isolated run (`isolate`): every driver switch off, so the moth
// neither moves nor hits (it stands `100` units away, outside contact reach
// anyway), and nothing else is on the field or in the HUD's slots. The moth is
// spawned through the real spawn path at a point on the lamplighter's row, and
// the movement is a real held ArrowRight for `MOVE_TICKS` frames, each frame's
// draw calls read as it renders. The moth's world position is read back from
// the snapshot on each frame rather than assumed, so a moth that moved would
// change the expectation rather than fail this point.
//
// WHAT IS READ, AND HOW A SPRITE IS TOLD. Each frame's `drawImage` calls, mapped
// through the transform in force, and among them the images drawn `24 x 32` and
// `20 x 20` units on the stage: the size a sprite is drawn at is what the
// specification fixes, whereas its file may be inlined by the bundler and its
// source may be an atlas the build packed. The nearest such draw to the
// expected point is the sprite, and its center is within `BLIT_TOL` (`1` unit)
// of the point, the case's allowance for a build that rounds a fractional
// world position to the pixel grid before it blits.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNotNull } from "../assert";
import {
  BLIT_TOL,
  LAMPLIGHTER_SIZE,
  STAGE_CX,
  STAGE_CY,
  enemySpriteSize,
} from "../constants";
import {
  captureReplay,
  createHarness,
  drawNearest,
  isolate,
  mustEnemy,
  placeEnemy,
  spriteDraws,
  stagePoint,
  type DrawCall,
  type Harness,
  type WickSnapshot,
  type XY,
} from "../harness";

/** Where the lamplighter is posed, off the origin so the formula is not `wx + 640`. */
const PLAYER_X = 300;
const PLAYER_Y = -120;

/** The moth, `100` units to the lamplighter's right on its row. */
const MOTH_X = 400;
const MOTH_Y = -120;

/** The frames of the held ArrowRight, each rendered and read. */
const MOVE_TICKS = 10;

const MOTH_SIZE = enemySpriteSize("moth");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** One rendered frame: the state it left and the drawing it issued. */
interface RenderedFrame {
  snapshot: WickSnapshot;
  calls: DrawCall[];
}

/** Run one frame and read both what it drew and what it left. */
async function renderFrame(h: Harness): Promise<RenderedFrame> {
  const calls = await h.frameCalls();
  const snapshot = await h.snapshot();
  return { snapshot, calls };
}

/** The draw of `size` nearest `at` sits within `BLIT_TOL` of it, or the point fails. */
function assertSpriteAt(
  calls: readonly DrawCall[],
  size: { width: number; height: number },
  at: XY,
  what: string,
): void {
  const candidates = spriteDraws(calls, size);
  const nearest = drawNearest(candidates, at);
  assertNotNull(
    nearest ?? null,
    `a ${size.width} x ${size.height} image drawn on the frame, for ${what}`,
  );
  const draw = nearest!;
  assertNear(draw.cx, at.x, BLIT_TOL, `the drawn center x of ${what}`);
  assertNear(draw.cy, at.y, BLIT_TOL, `the drawn center y of ${what}`);
}

it("draws the lamplighter at the stage center and a moth by the camera formula, before and through a move", async () => {
  await isolate(h);
  await h.debug.setPlayerPosition(PLAYER_X, PLAYER_Y);
  const moth = await placeEnemy(h, "moth", MOTH_X, MOTH_Y);

  const frames = await captureReplay(h, "camera", async () => {
    const seen: RenderedFrame[] = [await renderFrame(h)];
    await h.hold("ArrowRight");
    try {
      for (let i = 0; i < MOVE_TICKS; i += 1) seen.push(await renderFrame(h));
    } finally {
      await h.release("ArrowRight");
    }
    return seen;
  });

  const rest = frames[0]!;
  assertEqual(rest.snapshot.screen, "playing", "the screen the frames ran on");
  assertEqual(rest.snapshot.run.player.x, PLAYER_X, "player.x as posed");
  assertEqual(rest.snapshot.run.player.y, PLAYER_Y, "player.y as posed");
  assertSpriteAt(
    rest.calls,
    LAMPLIGHTER_SIZE,
    { x: STAGE_CX, y: STAGE_CY },
    "the lamplighter at rest",
  );
  assertSpriteAt(
    rest.calls,
    MOTH_SIZE,
    { x: STAGE_CX + (MOTH_X - PLAYER_X), y: STAGE_CY + (MOTH_Y - PLAYER_Y) },
    "the moth 100 units to the lamplighter's right, at rest",
  );

  frames.slice(1).forEach((frame, i) => {
    const tick = i + 1;
    assertEqual(
      frame.snapshot.screen,
      "playing",
      `the screen on tick ${tick} of the move`,
    );
    const at = mustEnemy(frame.snapshot, moth.id);
    assertSpriteAt(
      frame.calls,
      LAMPLIGHTER_SIZE,
      { x: STAGE_CX, y: STAGE_CY },
      `the lamplighter on tick ${tick} of the move`,
    );
    assertSpriteAt(
      frame.calls,
      MOTH_SIZE,
      stagePoint(frame.snapshot, at.x, at.y),
      `the moth on tick ${tick} of the move, under the camera formula`,
    );
  });
});
