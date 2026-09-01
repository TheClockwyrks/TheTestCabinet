// Wick — instrumentation/set-player-position: `setPlayerPosition(300, -120)`
// on `playing` sets `player.x` to 300 and `player.y` to -120, the next render
// draws the lamplighter at the stage center, and a held Halo aura is centered
// there on the next tick.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `setPlayerPosition(x, y)`): "Sets the lamplighter's center to `(x, y)`.
// Nothing else moves: the camera follows on the next render, and the aura and
// lanterns follow on the next tick." specs/world.md — "The camera and the
// view": "the lamplighter is always drawn at the center of the stage", at
// `(STAGE_CX, STAGE_CY)` (`640, 360`); specs/assets.md fixes the lamplighter's
// idle sprite at `24 x 32`. The drawn center is read to `BLIT_TOL`, since a
// build may round to the pixel grid; the state is read exactly.
//
// WHY THE WORLD IS POSED AS IT IS. Halo is held and its aura placed before the
// pose, so the tick after the pose must re-center it; the lamplighter stands
// still, so the sprite drawn at the stage center is the idle one and its
// natural size names it among the frame's images.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import {
  BLIT_TOL,
  LAMPLIGHTER_SIZE,
  STAGE_CX,
  STAGE_CY,
} from "../constants";
import {
  captureStill,
  createHarness,
  holdWeapon,
  imageDraws,
  isolate,
  zonesOfKind,
  type Harness,
} from "../harness";

const POSED = { x: 300, y: -120 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("poses the lamplighter's center, drawn at the stage center, the aura following", async () => {
  await isolate(h);
  await holdWeapon(h, "halo", 1);
  await h.step(1);

  await h.debug.setPlayerPosition(POSED.x, POSED.y);
  const posed = await h.snapshot();
  assertEqual(posed.run.player.x, POSED.x, "player.x after the pose");
  assertEqual(posed.run.player.y, POSED.y, "player.y after the pose");

  // The next render: the lamplighter's sprite is drawn centered on the stage.
  const calls = await h.frameCalls();
  const centered = imageDraws(calls).filter(
    (draw) =>
      draw.image.width === LAMPLIGHTER_SIZE.width &&
      draw.image.height === LAMPLIGHTER_SIZE.height &&
      Math.abs(draw.cx - STAGE_CX) <= BLIT_TOL &&
      Math.abs(draw.cy - STAGE_CY) <= BLIT_TOL,
  );
  await captureStill(h, "posed");
  assertTrue(
    centered.length > 0,
    `a ${LAMPLIGHTER_SIZE.width} x ${LAMPLIGHTER_SIZE.height} sprite drawn at the stage center on the next render`,
  );

  // And the tick that frame ran re-centered the aura on the posed point.
  const after = await h.snapshot();
  const auras = zonesOfKind(after, "aura");
  assertLength(auras, 1, "the Halo aura");
  assertEqual(auras[0]?.x, POSED.x, "the aura's x on the tick after the pose");
  assertEqual(auras[0]?.y, POSED.y, "the aura's y on the tick after the pose");
});
