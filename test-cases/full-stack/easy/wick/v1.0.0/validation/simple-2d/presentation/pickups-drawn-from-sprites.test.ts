// presentation/pickups-drawn-from-sprites — each pickup kind is drawn from its
// own produced sprite, on its own position.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The sprites"): "Pickups |
// assets/sprites/pickups/chest.png, bread.png, draft.png | draw | 1 each |
// 24 x 24", and "Each is drawn centered on the thing it depicts".
// specs/world.md ("The camera and the view") fixes where that lands: "A world
// point (wx, wy) is drawn at the stage position (wx - player.x + STAGE_CX,
// wy - player.y + STAGE_CY)". specs/overview.md ("Visual design") holds the
// three to being told apart: "A chest, bread, and a draft are told apart from
// each other and from any gem."
//
// THE WORLD. An isolated playing run (`isolate`): nothing else on the field, no
// weapon held, every driver switch off. One of each kind is placed well beyond
// the collection distance, PICKUP_ITEM_RADIUS (16) plus PLAYER_RADIUS (12), so
// none is collected out from under the frame and no chest overlay opens, and
// the three stand well apart from each other.
//
// WHAT IS READ. One frame's blits, and where the blit of each kind's own file
// landed against the camera formula's point for that pickup's snapshot
// position. A build that drew a pickup as a shape of its own, or drew one
// kind's file for another's, fails on the kind it belongs to.
//
// TOLERANCE. DRAWN_POINT_TOLERANCE (1 unit) on each drawn center, the case's
// tolerance for a sprite a build may snap to whole device pixels. The three
// pickups stand hundreds of units apart, so a drawn center cannot be attributed
// to the wrong one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import {
  DRAWN_POINT_TOLERANCE,
  PICKUP_KINDS,
  PICKUP_PATHS,
  type PickupKind,
} from "../constants";
import {
  blitCenterOnStage,
  captureStill,
  createHarness,
  isolate,
  present,
  spawnPickupAt,
  worldToStage,
  type Harness,
} from "../harness";
import { drawnFile } from "./drawn";

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
  h?.dispose();
});

it("draws each pickup kind from its own produced sprite", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the frame is drawn on");
  const placed = PICKUP_KINDS.map((kind) => ({
    kind,
    id: spawnPickupAt(h, kind, LIES_AT[kind].x, LIES_AT[kind].y),
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
    const pickup = present(
      snapshot.run.pickups.find((lying) => lying.id === id),
      `the ${kind} placed through the surface`,
    );
    const at = worldToStage(snapshot.run.player, pickup.x, pickup.y);
    const drawn = blitCenterOnStage(
      h,
      drawnFile(blits, PICKUP_PATHS[kind], kind),
    );
    assertWithin(
      drawn.x,
      at.x,
      DRAWN_POINT_TOLERANCE,
      `the drawn center x of ${PICKUP_PATHS[kind]}`,
    );
    assertWithin(
      drawn.y,
      at.y,
      DRAWN_POINT_TOLERANCE,
      `the drawn center y of ${PICKUP_PATHS[kind]}`,
    );
  }
});
