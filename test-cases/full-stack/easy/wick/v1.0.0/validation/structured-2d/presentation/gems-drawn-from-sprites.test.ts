// presentation/gems-drawn-from-sprites — each gem tier is drawn from its own
// produced sprite, on its own position.
//
// WHERE THE FIGURES COME FROM. `specs/assets.md`, "The sprites": "Gems |
// `assets/sprites/gems/small.png`, `medium.png`, `large.png` | `draw` | `1`
// each | `8 x 8`, `12 x 12`, `16 x 16`", and "Each is drawn centered on the
// thing it depicts". `specs/world.md`, "The camera and the view", fixes where
// that lands: "A world point `(wx, wy)` is drawn at the stage position
// `(wx - player.x + STAGE_CX, wy - player.y + STAGE_CY)`".
// `specs/assets.md`, "Genuinely produced": "Every moth, bolt, and gem on screen
// is a produced sprite".
//
// THE BOUND. `SPRITE_TOL` (2 device pixels) on each drawn centre, the rounding
// a build that lands its destination rectangle on whole device pixels picks up;
// the harness opens at the stage's own `1280 x 720`, where one device pixel is
// one stage unit. The three gems lie 200 units apart, so a drawn centre cannot
// be attributed to the wrong gem, and a build that drew a gem as a shape of its
// own, or drew one tier's file on another's gem, fails on the tier it belongs
// to.
//
// THE WORLD, AND WHY. An isolated world holding the three gems and nothing
// else: no weapon held and every driver switch off. Each lies far beyond
// `pickupRadius` (`48` with no Lure held), so none is attracted or collected
// out from under the frame.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { GEM_PATHS, GEM_TIERS, assetFile, type GemTier } from "../constants";
import {
  captureStill,
  createHarness,
  gemById,
  isolate,
  placeGem,
  type Harness,
} from "../harness";
import { SPRITE_TOL, drawnFrom } from "./sprites";

/** Where each tier lies: far beyond `pickupRadius`, and 200 units apart. */
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
  h.dispose();
});

it("draws each gem tier from its own produced sprite", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the frame is drawn on");
  const placed = GEM_TIERS.map((tier) => ({
    tier,
    id: placeGem(h, tier, LIES_AT[tier].x, LIES_AT[tier].y),
  }));

  const blits = await h.frameBlits();
  captureStill(h, "gems");
  const snapshot = h.snapshot();

  for (const { tier, id } of placed) {
    const gem = gemById(snapshot, id);
    assertGreaterThan(
      gem === undefined ? 0 : 1,
      0,
      `the ${tier} gem placed through the surface, still on the field`,
    );
    const at = gem as { x: number; y: number };
    const drawn = drawnFrom(
      h,
      blits,
      [assetFile(GEM_PATHS[tier])],
      at.x,
      at.y,
      SPRITE_TOL,
    );
    assertGreaterThan(
      drawn.length,
      0,
      `${GEM_PATHS[tier]} drawn centred on the ${tier} gem, where it lies at ` +
        `(${at.x}, ${at.y})`,
    );
  }
});
