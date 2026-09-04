// presentation/gripper-placed-at-its-live-hex — a gripper sprite stands on the hex
// the arm's LIVE pose puts that gripper on.
//
// THE RULE is two sentences read together. `specs/parts.md` fixes the hex: an arm
// carries "one gripper per spoke at `base + length * DIRS[d]` for each spoke
// direction `d`". `specs/assets.md` fixes the drawing: the gripper sprites are
// "`32 x 32`", "centered on each gripper's live position", and every sprite is
// "authored at the canvas its table row states and drawn at that size in logical
// units, centered on the thing it depicts, so nothing is scaled at draw time".
//
// LIVE, NOT REST. `specs/instrumentation.md` keeps the two apart: "A part's rest
// pose and its live pose are separate", `editor.parts` carrying the rest pose and
// `sim.poses` the live one. `setPoseLength` "Sets that part's live length,
// `ARM_MIN_LEN` (`1`) to `ARM_MAX_LEN` (`3`) ... leaving its rest rotation in
// `editor.parts` as it stands" — the faculty gate for a pose, "which move it with
// no tape running". So the check moves the live length alone and reads where the
// sprite went.
//
// THE PART IS A PISTON because a piston is the arm "whose length changes at run
// time" (`specs/parts.md`), so a live length that differs from the rest length is
// the ordinary thing about it rather than a contrivance. Its tape is blank, "which
// every part rests on" (`specs/instrumentation.md`), so nothing but the pose moves
// it, and the field is otherwise empty.
//
// THE VERDICT. At live length `1` the `32 x 32` sprite is centered on
// `base + 1 * DIRS[0]` and there is none on `base + 3 * DIRS[0]`; at live length
// `3` it is centered on `base + 3 * DIRS[0]` and there is none on
// `base + 1 * DIRS[0]`. A build drawing the gripper at the arm's REST length
// leaves it on the first hex both times.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import { ARM_MAX_LEN, ARM_MIN_LEN, GRIPPER_SPRITE_SIZE } from "../constants";
import { hexCenter, type Hex } from "../field";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  imagesNear,
  openBareRun,
  partIds,
  poseOf,
  posePart,
  type DrawCall,
  type Harness,
  type ImageDraw,
} from "../harness";
import { gripperHex } from "../parts";

/** The piston stands at rotation `0`, so its one spoke is direction `0`. */
const SPOKE = 0;

/** How near a sprite's centre must land to count as drawn on a hex. */
const ON_POINT = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The gripper-sized sprites a frame drew centred on a hex. */
function grippersOn(calls: readonly DrawCall[], hex: Hex): ImageDraw[] {
  return imagesNear(calls, hexCenter(hex), ON_POINT).filter(
    (draw) =>
      draw.image.width === GRIPPER_SPRITE_SIZE &&
      draw.image.height === GRIPPER_SPRITE_SIZE,
  );
}

it("moves the gripper sprite out with the live length", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("piston", ORIGIN.q, ORIGIN.r, 0, ARM_MIN_LEN, []),
    ]),
  });
  const piston = (await partIds(h))[0] ?? -1;

  const near = gripperHex(ORIGIN, SPOKE, ARM_MIN_LEN);
  const far = gripperHex(ORIGIN, SPOKE, ARM_MAX_LEN);

  await h.advance(1);
  const short = await h.lastCalls();

  const posed = await h.snapshot();
  assertEqual(
    poseOf(posed, piston)?.length,
    ARM_MIN_LEN,
    "the piston's live length is 1, so its gripper stands on base + 1 * DIRS[0]",
  );

  const atNear = grippersOn(short, near);
  assertLength(
    atNear,
    1,
    "one 32 x 32 gripper sprite is centered on the live gripper hex",
  );
  const nearDraw = atNear[0];
  assertNotNull(nearDraw, "the gripper's sprite was read off the frame");
  assertEqual(
    Math.round(Math.abs(nearDraw?.dw ?? 0)),
    GRIPPER_SPRITE_SIZE,
    "drawn at its native canvas, so nothing is scaled at draw time",
  );
  assertLength(
    grippersOn(short, far),
    0,
    "and none stands on base + 3 * DIRS[0], where the gripper is not",
  );

  await posePart(h, piston, { length: ARM_MAX_LEN });
  await h.advance(1);
  await captureStill(h, "reach");
  const long = await h.lastCalls();

  const reached = await h.snapshot();
  assertEqual(
    poseOf(reached, piston)?.length,
    ARM_MAX_LEN,
    "the live length is now 3, the rest length in editor.parts left as it stood",
  );
  assertEqual(
    (await h.snapshot()).editor.parts[0]?.length,
    ARM_MIN_LEN,
    "posing a live length leaves the rest pose alone, so the two really differ",
  );

  const atFar = grippersOn(long, far);
  assertLength(
    atFar,
    1,
    "the gripper sprite has moved out to base + 3 * DIRS[0], its live gripper hex",
  );
  assertEqual(
    Math.round(Math.abs(atFar[0]?.dw ?? 0)),
    GRIPPER_SPRITE_SIZE,
    "and is still drawn at its native 32 x 32 canvas",
  );
  assertLength(
    grippersOn(long, near),
    0,
    "and none is left behind on the hex the rest length would have put it on",
  );
});
