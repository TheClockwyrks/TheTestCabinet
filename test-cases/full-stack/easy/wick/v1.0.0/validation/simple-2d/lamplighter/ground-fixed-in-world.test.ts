// lamplighter/ground-fixed-in-world — the ground pattern is fixed in world
// space.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("The camera and the view"):
// "The ground is drawn as a pattern fixed in world space and repeating on both
// axes, so that the lamplighter's motion reads against it", under the camera
// formula the same section fixes, "A world point (wx, wy) is drawn at the
// stage position (wx - player.x + STAGE_CX, wy - player.y + STAGE_CY)".
// specs/assets.md fixes what the pattern is made of: "Ground tile,
// assets/sprites/ground.png, 64 x 64", "the ground is that tile repeated across
// the world", and under "What stays drawn in code", "The ground, as the
// produced tile repeated in world space". A tile fixed in world space keeps
// its world position as the lamplighter walks, so the tile drawn under any
// world point is the same tile, at the same world corner, on every frame.
//
// THE WORLD. An isolated playing run (`isolate`): nothing on the field, no
// weapon held, every driver switch off, the lamplighter at the origin. One
// frame is drawn standing, then ArrowRight is held for HELD_TICKS and the last
// held frame is read; the walk is whatever the build made of the key, since the
// formula holds for any displacement and the rate belongs to `move-speed`.
//
// WHAT IS READ. On each frame, the blit of `ground.png` whose box covers the
// stage point the camera formula gives a fixed world point WORLD_POINT, well
// away from the lamplighter, and that blit's top-left corner mapped back into
// world units through the same formula against that frame's own player
// position. The corner is the same world point on both frames exactly when the
// tile stayed put in the world while the lamplighter moved, which on the stage
// is the tile boundaries shifting by the opposite of the walk. A ground drawn
// fixed to the stage, or scrolled at any other rate, reads a corner displaced
// by the walk or by the difference. A frame that blits no ground tile at all
// has nothing fixed in world space to read and fails.
//
// TOLERANCE. DRAWN_POINT_TOLERANCE (1 unit) on each world coordinate of the
// corner, the case's tolerance for a tile a build may snap to whole device
// pixels: a walk of HELD_TICKS ticks is 3 units a tick, so a stage-fixed
// ground misses by tens of units.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertWithin } from "../assert";
import {
  BINDINGS,
  DRAWN_POINT_TOLERANCE,
  GROUND_TILE_PATH,
  STAGE_CX,
  STAGE_CY,
} from "../constants";
import {
  blitBoxOnStage,
  blitsOf,
  blitsOfFile,
  captureReplay,
  createHarness,
  isolate,
  worldToStage,
  type Blit,
  type Harness,
  type Point,
  type WickSnapshot,
} from "../harness";

/** The first key specs/controls.md binds to `right`: ArrowRight. */
const KEY = BINDINGS.right[0];

/** Ticks the key is held: a walk shorter than one tile, so the shift is plain. */
const HELD_TICKS = 12;

/** A world point clear of the lamplighter, inside the view on both frames. */
const WORLD_POINT: Point = { x: -200, y: -100 };

/**
 * The world corner of the ground tile drawn under `WORLD_POINT` on a frame:
 * the blit's stage box mapped back through the camera formula of
 * specs/world.md against the frame's own player position.
 */
function tileCornerInWorld(
  h: Harness,
  blits: readonly Blit[],
  snapshot: WickSnapshot,
  name: string,
): Point {
  const { player } = snapshot.run;
  const at = worldToStage(player, WORLD_POINT.x, WORLD_POINT.y);
  const covering = blitsOfFile(blits, GROUND_TILE_PATH).filter((blit) => {
    const box = blitBoxOnStage(h, blit);
    return (
      at.x >= box.x &&
      at.x < box.x + box.w &&
      at.y >= box.y &&
      at.y < box.y + box.h
    );
  });
  const tile = covering[covering.length - 1];
  assertDefined(
    tile,
    `a drawImage of ${GROUND_TILE_PATH} covering world (${WORLD_POINT.x}, ${WORLD_POINT.y}) on the ${name} frame, at stage (${at.x}, ${at.y})`,
  );
  const box = blitBoxOnStage(h, tile);
  return {
    x: box.x + player.x - STAGE_CX,
    y: box.y + player.y - STAGE_CY,
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps the ground tile under a world point at the same world corner as the lamplighter walks", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the frames are drawn on");

  const { first, second } = await captureReplay(h, "ground", async () => {
    const firstBlits = await h.frameBlits();
    const firstSnap = h.snapshot();
    h.holdKey(KEY);
    try {
      await h.tick(HELD_TICKS);
    } finally {
      h.releaseKey(KEY);
    }
    return {
      first: { blits: firstBlits, snap: firstSnap },
      second: { blits: blitsOf(h.lastCalls()), snap: h.snapshot() },
    };
  });

  const before = tileCornerInWorld(h, first.blits, first.snap, "standing");
  const after = tileCornerInWorld(h, second.blits, second.snap, "walked");
  const walked = second.snap.run.player.x - first.snap.run.player.x;
  assertWithin(
    after.x,
    before.x,
    DRAWN_POINT_TOLERANCE,
    `the world x of the ground tile's corner under (${WORLD_POINT.x}, ${WORLD_POINT.y}) after a walk of ${walked} units, against before it`,
  );
  assertWithin(
    after.y,
    before.y,
    DRAWN_POINT_TOLERANCE,
    `the world y of the ground tile's corner under (${WORLD_POINT.x}, ${WORLD_POINT.y}) after a walk of ${walked} units, against before it`,
  );
});
