// instrumentation/set-player-position — `setPlayerPosition(300, -120)` on
// playing sets player.x to 300 and player.y to -120, the next render draws
// the lamplighter at the stage center, and a held Halo aura is centered there
// on the next tick.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md,
// `setPlayerPosition`: "Sets the lamplighter's center to `(x, y)`. Nothing
// else moves: the camera follows on the next render, and the aura and lanterns
// follow on the next tick". specs/world.md, "The camera and the view": "the
// lamplighter is always drawn at the center of the stage", (STAGE_CX,
// STAGE_CY). specs/assets.md has the lamplighter drawn as its produced idle
// sprite when still, centered on it.
//
// THE POSE. An isolated run holding Halo; the pose; the read-back without a
// frame; then one frame, which under this harness is one tick: the aura sits
// at the posed point and a produced lamplighter sprite is blitted about the
// stage center.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import {
  LAMPLIGHTER_SPRITE_HEIGHT,
  LAMPLIGHTER_SPRITE_WIDTH,
  LAMPLIGHTER_WALK_DIR,
  LAMPLIGHTER_IDLE_PATH,
  STAGE_CX,
  STAGE_CY,
} from "../constants";
import {
  assetPath,
  blitsNear,
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  zonesOfKind,
  type Harness,
} from "../harness";

const POSED = { x: 300, y: -120 };
/** Half the sprite's diagonal: a blit centered on the lamplighter lands within it. */
const SPRITE_REACH =
  Math.hypot(LAMPLIGHTER_SPRITE_WIDTH, LAMPLIGHTER_SPRITE_HEIGHT) / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the lamplighter, the camera, and the aura", async () => {
  isolate(h);
  holdWeapon(h, "halo", 1);
  await h.tick(1);

  h.debug.setPlayerPosition(POSED.x, POSED.y);
  const s = h.snapshot();
  assertEqual(s.run.player.x, POSED.x, "player.x read back");
  assertEqual(s.run.player.y, POSED.y, "player.y read back");

  const blits = await h.frameBlits();
  captureStill(h, "posed");
  const after = h.snapshot();
  const auras = zonesOfKind(after, "aura");
  assertLength(auras, 1, "the aura on the next tick");
  assertEqual(auras[0].x, POSED.x, "the aura's x, centered on the posed point");
  assertEqual(auras[0].y, POSED.y, "the aura's y, centered on the posed point");

  const lamplighter = blitsNear(
    h,
    blits,
    STAGE_CX,
    STAGE_CY,
    SPRITE_REACH,
  ).filter(
    (blit) =>
      blit.id === assetPath(LAMPLIGHTER_IDLE_PATH) ||
      blit.id.startsWith(assetPath(LAMPLIGHTER_WALK_DIR)),
  );
  assertGreaterThan(
    lamplighter.length,
    0,
    "lamplighter sprites blitted about the stage center after the pose",
  );
});
