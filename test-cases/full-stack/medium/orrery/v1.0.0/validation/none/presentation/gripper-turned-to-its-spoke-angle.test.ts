// presentation/gripper-turned-to-its-spoke-angle — each gripper sprite is turned to
// the bearing of the spoke it stands on.
//
// THE RULE, from the Grippers row of `specs/assets.md`'s sprite table: the sprites
// are drawn "centered on each gripper's live position AND TURNED TO THAT SPOKE'S
// LIVE ANGLE". "The rows that name a live angle are drawn turned to it"
// (`specs/assets.md`, Scale) says the same of the whole table.
//
// WHAT A SPOKE'S ANGLE IS. `specs/parts.md` puts the gripper on spoke `d` at
// `base + length * DIRS[d]`, and `specs/field.md` fixes where a hex sits on the
// stage, so the bearing of spoke `d` is the bearing from the anchor's centre to
// that gripper hex's centre — a figure this check computes from `field.ts` rather
// than reads off the build.
//
// WHAT IS NOT READ, AND WHY. Which way the produced sprite POINTS on its own
// canvas is the build's: `specs/assets.md` fixes no orientation for the artwork,
// only that each drawn gripper is turned to its spoke's angle. A build whose
// gripper is drawn pointing north on its canvas turns every one of them by the
// spoke bearing plus a quarter turn, and it has met the requirement exactly. So
// the verdict is taken over the DIFFERENCES between the six: each gripper's drawn
// rotation must sit the same distance from its spoke's bearing as every other's
// does from its own. That is what "turned to that spoke's angle" delivers on the
// field, and it fails a build that draws every gripper at one angle.
//
// THE WORLD IS ONE HEXARM, which is "Six grippers, one per spoke"
// (`specs/parts.md`) — the one part that puts all six spoke angles on the field at
// once, on one frame, with one produced sprite. Its tape is blank, "which every
// part rests on", and the field is empty, so no gripper holds anything and all six
// are the same sprite in six orientations.
//
// THE VERDICT. Each of the six spoke hexes carries one `32 x 32` gripper sprite,
// and the offset between a gripper's drawn rotation and its spoke's bearing is the
// same for all six.

import { afterEach, beforeEach, it } from "vitest";
import { assertAngleNear, assertLength, assertNotNull } from "../assert";
import { GRIPPER_SPRITE_SIZE } from "../constants";
import { hexCenter, type Hex } from "../field";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  imagesNear,
  openBareRun,
  type DrawCall,
  type Harness,
  type ImageDraw,
} from "../harness";
import { gripperHex, spokesOf } from "../parts";

/** How near a sprite's centre must land to count as drawn on a hex. */
const ON_POINT = 6;

/**
 * How near two drawn bearings must agree, in degrees.
 *
 * The six spokes are sixty degrees apart, so a span this wide cannot let one
 * spoke's angle stand in for another's; it is here for the rounding a transform
 * read back off a frame carries.
 */
const ANGLE_TOLERANCE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The bearing from one hex's centre to another's, in degrees clockwise. */
function bearing(from: Hex, to: Hex): number {
  const a = hexCenter(from);
  const b = hexCenter(to);
  return ((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 360) % 360;
}

/** The one gripper-sized sprite a frame drew centred on a hex, or `null`. */
function gripperOn(calls: readonly DrawCall[], hex: Hex): ImageDraw | null {
  const drawn = imagesNear(calls, hexCenter(hex), ON_POINT).filter(
    (draw) =>
      draw.image.width === GRIPPER_SPRITE_SIZE &&
      draw.image.height === GRIPPER_SPRITE_SIZE,
  );
  return drawn.length === 1 ? (drawn[0] as ImageDraw) : null;
}

it("turns each of a hexarm's six grippers by its own spoke's bearing", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("hexarm", ORIGIN.q, ORIGIN.r, 0, 1, [])]),
  });

  await h.advance(1);
  await captureStill(h, "spokes");
  const calls = await h.lastCalls();

  const spokes = spokesOf("hexarm", 0);
  assertLength(
    spokes,
    6,
    "a hexarm carries one gripper on each of the six spokes",
  );

  const offsets: number[] = [];
  for (const spoke of spokes) {
    const hex = gripperHex(ORIGIN, spoke, 1);
    const draw = gripperOn(calls, hex);
    assertNotNull(
      draw,
      `spoke ${String(spoke)} carries one 32 x 32 gripper sprite on its hex`,
    );
    if (draw === null) continue;
    offsets.push((draw.angle - bearing(ORIGIN, hex) + 720) % 360);
  }
  assertLength(offsets, 6, "all six grippers were read off the one frame");

  const first = offsets[0] ?? 0;
  for (const [index, offset] of offsets.entries()) {
    assertAngleNear(
      offset,
      first,
      ANGLE_TOLERANCE,
      `the gripper on spoke ${String(spokes[index])} is turned to that spoke's ` +
        "angle, so it sits the same way round on its own bearing as the gripper " +
        "on spoke 0 does on its — whichever way the produced sprite itself points",
    );
  }
});
