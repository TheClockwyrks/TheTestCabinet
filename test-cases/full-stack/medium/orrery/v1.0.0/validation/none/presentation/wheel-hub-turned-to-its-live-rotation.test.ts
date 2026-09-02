// presentation/wheel-hub-turned-to-its-live-rotation — the hub turns with the
// wheel underneath it.
//
// THE RULE, from the Wheel hub row of `specs/assets.md`'s sprite table: the file is
// drawn "centered on the wheel's anchor hex AND TURNED TO THE WHEEL'S LIVE
// ROTATION", and "The rows that name a live angle are drawn turned to it"
// (`specs/assets.md`, Scale). The live rotation is the one `sim.poses` carries:
// `specs/instrumentation.md` puts `{ part, rotation, length, cell }` there and
// keeps it apart from the rest pose in `editor.parts`.
//
// WHAT ONE STEP OF ROTATION IS WORTH ON THE STAGE. A rotation is a `DIRS` index,
// and `specs/parts.md` puts an arm's gripper on spoke `d` at
// `base + length * DIRS[d]`, so the bearing one step of rotation moves a part
// through is the bearing between two adjacent spoke hexes as `specs/field.md`
// places them — sixty degrees, computed here from `field.ts` rather than assumed.
// `specs/simulation.md` fixes the direction: `rotate-cw` turns "the part's
// direction ... 60 degrees about its base, clockwise", sweeping "`60 * t`
// degrees", so one whole cycle of `rotate-cw` is exactly one step.
//
// WHY TWO WHEELS. Which way round the produced hub sits on its own canvas is the
// build's — `specs/assets.md` fixes no orientation for the artwork — so the
// verdict is a DIFFERENCE rather than an absolute angle. A second wheel with a
// blank tape, "which every part rests on" (`specs/instrumentation.md`), stands at
// live rotation `0` throughout and is read off the SAME FRAME as the first, so
// what is compared is one produced sprite drawn at two live rotations. That also
// fails a build that turned every wheel on the field together.
//
// BOTH RINGS ARE OFF THE FIELD. The wheels are loaded as the machine, so
// `startRun` raises their fixtures and the bare opener's `clearMotes` takes them
// off again — the faculty gate for a wheel's fixtures. Nothing else on the field
// is drawn on a `48 x 48` canvas, so each anchor carries exactly its own hub, and
// with no motes anywhere no pair can collide while the first wheel turns.
//
// THE VERDICT. After one cycle of `rotate-cw`, the turning wheel's live rotation
// is `1` and the resting wheel's is `0`, and the two hubs' drawn angles differ by
// exactly the one step of bearing the field geometry fixes.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertAngleNear,
  assertEqual,
  assertLength,
  assertNotNull,
} from "../assert";
import { WHEEL_SPRITE_SIZE } from "../constants";
import { hexCenter, turnDirection, type Hex } from "../field";
import { armPart, solution } from "../formats";
import { BARE, EAST, WEST } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  imagesNear,
  openBareRun,
  partIds,
  poseOf,
  type DrawCall,
  type Harness,
  type ImageDraw,
} from "../harness";
import { gripperHex } from "../parts";

/** How near a sprite's centre must land to count as drawn on a hex. */
const ON_POINT = 6;

/** How near two drawn bearings must agree, in degrees. */
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

/** The one wheel-sized sprite a frame drew centred on a hex, or `null`. */
function hubOn(calls: readonly DrawCall[], hex: Hex): ImageDraw | null {
  const drawn = imagesNear(calls, hexCenter(hex), ON_POINT).filter(
    (draw) =>
      draw.image.width === WHEEL_SPRITE_SIZE &&
      draw.image.height === WHEEL_SPRITE_SIZE,
  );
  return drawn.length === 1 ? (drawn[0] as ImageDraw) : null;
}

it("turns the hub one step for one rotate-cw, leaving a resting wheel's hub where it was", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("wheel", WEST.q, WEST.r, 0, 1, ["rotate-cw"]),
      armPart("wheel", EAST.q, EAST.r, 0, 1, []),
    ]),
  });
  const ids = await partIds(h);
  const turning = ids[0] ?? -1;
  const resting = ids[1] ?? -1;

  // The frame's operations are read INSIDE the capture, on the frame the drive
  // ended on: a recording harvests the frames it armed, so `lastCalls` outside it
  // is not the picture the cycle finished on.
  const calls = await captureReplay(h, "turn", async () => {
    await advanceCycles(h, 1);
    return h.lastCalls();
  });

  const turned = await h.snapshot();
  assertLength(
    turned.sim?.motes ?? [],
    0,
    "both rings are off the field, so each anchor carries its own hub and nothing else",
  );
  assertEqual(
    poseOf(turned, turning)?.rotation,
    1,
    "one whole cycle of rotate-cw leaves the turning wheel's live rotation one step on",
  );
  assertEqual(
    poseOf(turned, resting)?.rotation,
    0,
    "and the wheel resting on a blank cell is still at live rotation 0",
  );

  const turnedHub = hubOn(calls, WEST);
  const restingHub = hubOn(calls, EAST);
  assertNotNull(
    turnedHub,
    "the turning wheel's hub is drawn on its anchor hex",
  );
  assertNotNull(restingHub, "the resting wheel's hub is drawn on its own");
  assertEqual(
    turnedHub?.image.id,
    restingHub?.image.id,
    "both wheels paint the one produced wheel hub, so what differs is the angle",
  );

  const step =
    bearing(WEST, gripperHex(WEST, turnDirection(0, 1), 1)) -
    bearing(WEST, gripperHex(WEST, 0, 1));
  assertAngleNear(
    (turnedHub?.angle ?? 0) - (restingHub?.angle ?? 0),
    step,
    ANGLE_TOLERANCE,
    "the hub is turned to the wheel's live rotation, so a wheel one step on " +
      "draws its hub one step of bearing round from a wheel that has not moved",
  );
});
