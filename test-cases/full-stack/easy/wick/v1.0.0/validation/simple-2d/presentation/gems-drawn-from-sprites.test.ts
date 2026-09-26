// presentation/gems-drawn-from-sprites — each gem tier is drawn from its own
// produced sprite, on its own position.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The sprites"): "Gems |
// assets/sprites/gems/small.png, medium.png, large.png | draw | 1 each |
// 8 x 8, 12 x 12, 16 x 16", and "Each is drawn centered on the thing it
// depicts". specs/world.md ("The camera and the view") fixes where that lands:
// "A world point (wx, wy) is drawn at the stage position
// (wx - player.x + STAGE_CX, wy - player.y + STAGE_CY)". specs/assets.md
// ("Genuinely produced") states the requirement plainly: "Every moth, bolt, and
// gem on screen is a produced sprite".
//
// THE WORLD. An isolated playing run (`isolate`): nothing else on the field, no
// weapon held, every driver switch off. One gem of each tier is placed beyond
// PICKUP_RADIUS (48) of the lamplighter, so none is attracted or collected out
// from under the frame, and the three stand well apart from each other.
//
// WHAT IS READ. One frame's blits, and where the blit of each tier's own file
// landed against the camera formula's point for that gem's snapshot position. A
// build that drew a gem as a shape of its own, or drew one tier's file for
// another's gem, fails on the tier it belongs to.
//
// TOLERANCE. DRAWN_POINT_TOLERANCE (1 unit) on each drawn center, the case's
// tolerance for a sprite a build may snap to whole device pixels. The three
// gems stand 200 units apart, so a drawn center cannot be attributed to the
// wrong gem.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import {
  DRAWN_POINT_TOLERANCE,
  GEM_PATHS,
  GEM_TIERS,
  type GemTier,
} from "../constants";
import {
  blitCenterOnStage,
  captureStill,
  createHarness,
  isolate,
  present,
  spawnGemAt,
  worldToStage,
  type Harness,
} from "../harness";
import { drawnFile } from "./drawn";

/** Where each tier lies: beyond PICKUP_RADIUS, and 200 units from the others. */
const LIES_AT: Readonly<Record<GemTier, { x: number; y: number }>> = {
  small: { x: -200, y: 0 },
  medium: { x: 0, y: -200 },
  large: { x: 200, y: 0 },
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws each gem tier from its own produced sprite", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the frame is drawn on");
  const placed = GEM_TIERS.map((tier) => ({
    tier,
    id: spawnGemAt(h, tier, LIES_AT[tier].x, LIES_AT[tier].y),
  }));

  const blits = await h.frameBlits();
  captureStill(h, "gems");
  const snapshot = h.snapshot();

  for (const { tier, id } of placed) {
    const gem = present(
      snapshot.run.gems.find((lying) => lying.id === id),
      `the ${tier} gem placed through the surface`,
    );
    const at = worldToStage(snapshot.run.player, gem.x, gem.y);
    const drawn = blitCenterOnStage(
      h,
      drawnFile(blits, GEM_PATHS[tier], `${tier} gem`),
    );
    assertWithin(
      drawn.x,
      at.x,
      DRAWN_POINT_TOLERANCE,
      `the drawn center x of ${GEM_PATHS[tier]}`,
    );
    assertWithin(
      drawn.y,
      at.y,
      DRAWN_POINT_TOLERANCE,
      `the drawn center y of ${GEM_PATHS[tier]}`,
    );
  }
});
