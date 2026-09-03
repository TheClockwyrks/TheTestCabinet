// presentation/pickups-drawn-from-sprites — each pickup kind is drawn from its
// own produced sprite, on its own position.
//
// WHERE THE FIGURES COME FROM. `specs/assets.md`, "The sprites": "Pickups |
// `assets/sprites/pickups/chest.png`, `bread.png`, `draft.png` | `draw` | `1`
// each | `24 x 24`", and "Each is drawn centered on the thing it depicts".
// `specs/world.md`, "The camera and the view", fixes where that lands: "A world
// point `(wx, wy)` is drawn at the stage position `(wx - player.x + STAGE_CX,
// wy - player.y + STAGE_CY)`". `specs/assets.md`, "Genuinely produced": "Every
// moth, bolt, and gem on screen is a produced sprite".
//
// THE BOUND. `SPRITE_TOL` (2 device pixels) on each drawn centre, the rounding
// a build that lands its destination rectangle on whole device pixels picks up;
// the harness opens at the stage's own `1280 x 720`, where one device pixel is
// one stage unit. The three lie hundreds of units apart, so a drawn centre
// cannot be attributed to the wrong pickup, and a build that drew one as a
// shape of its own, or drew one kind's file on another's, fails on the kind it
// belongs to.
//
// THE WORLD, AND WHY. An isolated world holding the three pickups and nothing
// else: no weapon held and every driver switch off. Each lies far beyond the
// collection distance, `PICKUP_ITEM_RADIUS` (`16`) plus `PLAYER_RADIUS` (`12`),
// so none is collected out from under the frame and no chest overlay opens.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  PICKUP_KINDS,
  PICKUP_PATHS,
  assetFile,
  type PickupKind,
} from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  pickupById,
  placePickup,
  type Harness,
} from "../harness";
import { SPRITE_TOL, drawnFrom } from "./sprites";

/** Where each kind lies: far past the collection distance, and far apart. */
const LIES_AT: Readonly<Record<PickupKind, { x: number; y: number }>> = {
  chest: { x: -300, y: 150 },
  bread: { x: 0, y: 220 },
  draft: { x: 300, y: 150 },
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws each pickup kind from its own produced sprite", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the frame is drawn on");
  const placed = PICKUP_KINDS.map((kind) => ({
    kind,
    id: placePickup(h, kind, LIES_AT[kind].x, LIES_AT[kind].y),
  }));

  const blits = await h.frameBlits();
  captureStill(h, "pickups");
  const snapshot = h.snapshot();
  assertEqual(
    snapshot.screen,
    "playing",
    "the screen after the frame, with every pickup still on the field",
  );

  for (const { kind, id } of placed) {
    const pickup = pickupById(snapshot, id);
    assertGreaterThan(
      pickup === undefined ? 0 : 1,
      0,
      `the ${kind} placed through the surface, still on the field`,
    );
    const at = pickup as { x: number; y: number };
    const drawn = drawnFrom(
      h,
      blits,
      [assetFile(PICKUP_PATHS[kind])],
      at.x,
      at.y,
      SPRITE_TOL,
    );
    assertGreaterThan(
      drawn.length,
      0,
      `${PICKUP_PATHS[kind]} drawn centred on the ${kind}, where it lies at ` +
        `(${at.x}, ${at.y})`,
    );
  }
});
