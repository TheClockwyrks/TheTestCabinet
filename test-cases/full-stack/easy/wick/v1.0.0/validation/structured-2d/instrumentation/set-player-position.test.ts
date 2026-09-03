// Wick — instrumentation/set-player-position: `setPlayerPosition(300, -120)`
// on `playing` sets the lamplighter's center, the next render draws the
// lamplighter at the stage center over that point, and a held Halo aura is
// centered there on the next tick.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setPlayerPosition(x, y)`: "Sets the lamplighter's center to `(x, y)`.
// Nothing else moves: the camera follows on the next render, and the aura and
// lanterns follow on the next tick." `specs/world.md`, "The camera and the
// view": "the lamplighter is always drawn at the center of the stage";
// `specs/ui.md`: the lamplighter is drawn at `(STAGE_CX, STAGE_CY)`.
// `specs/assets.md` centers the produced idle sprite on the lamplighter.
//
// THE DRIVE. An isolated run with Halo held and one tick so the aura exists,
// the pose, a read, one frame (which is one tick: the aura re-centers, the
// render follows): the world point (300, -120) maps to the stage center
// through the engine's camera, the produced idle sprite is blitted centered
// there (within 2 device pixels, half its odd-pixel rounding), and the aura's
// center is the posed point, exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertPointNear } from "../assert";
import { LAMPLIGHTER_IDLE_PATH, STAGE_CX, STAGE_CY } from "../constants";
import {
  advanceTicks,
  blitCenter,
  blitsFrom,
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  zonesOfKind,
  type Harness,
} from "../harness";

const POSED_X = 300;
const POSED_Y = -120;
const BLIT_TOL = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("poses the center, draws the lamplighter at the stage center over it, and re-centers the aura", async () => {
  isolate(h);
  holdWeapon(h, "halo");
  await advanceTicks(h, 1);

  h.debug.setPlayerPosition(POSED_X, POSED_Y);
  const posed = h.snapshot();
  const { blits } = await h.frameDraw();
  captureStill(h, "posed");

  assertEqual(posed.run.player.x, POSED_X, "player.x after setPlayerPosition");
  assertEqual(posed.run.player.y, POSED_Y, "player.y after setPlayerPosition");

  const center = h.device(POSED_X, POSED_Y);
  assertEqual(
    center.x,
    STAGE_CX,
    "the posed point's device x through the camera",
  );
  assertEqual(
    center.y,
    STAGE_CY,
    "the posed point's device y through the camera",
  );
  const idle = blitsFrom(blits, LAMPLIGHTER_IDLE_PATH);
  assertGreaterThan(idle.length, 0, "blits of the lamplighter's idle sprite");
  assertPointNear(
    blitCenter(idle[idle.length - 1]),
    center,
    BLIT_TOL,
    "the idle sprite's center",
  );

  const [aura] = zonesOfKind(h.snapshot(), "aura");
  assertEqual(aura?.x, POSED_X, "the aura's x on the tick after the pose");
  assertEqual(aura?.y, POSED_Y, "the aura's y on the tick after the pose");
});
