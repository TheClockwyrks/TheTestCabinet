// presentation/gripper-follows-its-live-length — half way through an `extend` the
// gripper sprite is half way along the hex it is travelling.
//
// THE RULE is `specs/simulation.md`'s motion table read through `specs/assets.md`'s
// placement. The table: "`extend`, `retract` | The piston's length changes by one,
// ITS GRIPPER TRANSLATING ONE HEX ALONG ITS SPOKE | Translation by the same vector,
// LINEARLY IN `t`", where `t` is "the fraction ... from `0` to `1`" the cycle is
// parameterized by, which `sim.fraction` reports. `specs/assets.md` then puts the
// sprite on that: the gripper is drawn "centered on each gripper's LIVE POSITION",
// at "`32 x 32`", "so nothing is scaled at draw time".
//
// So at `t = 1/2` of an `extend` the gripper is half of one hex out: the midpoint
// of the segment between the hex it left, `base + 1 * DIRS[0]`, and the hex it is
// bound for, `base + 2 * DIRS[0]` (`specs/parts.md`). Those two centres are
// `HEX_PITCH` (`48`) apart, so the midpoint is `24` from each — a place a build
// that snapped its gripper to either end of the motion cannot draw it.
//
// THE FRACTION IS DRIVEN, NOT WAITED FOR. `advanceFraction` runs one frame
// covering exactly half a cycle of game time, and `specs/instrumentation.md`
// guarantees the state that reaches: "an interval of game time reaches the same
// state however it was divided into frames". `sim.fraction` is read through
// `FRACTION_TOLERANCE` because it is one of the three figures the specification
// carries "as running sums of the frames' own delta times", which "agree to within
// the rounding of that sum rather than bit for bit".
//
// THE WORLD IS ONE PISTON with `extend` alone on its tape and an empty field, so
// the only thing moving is the gripper whose position is under test, and nothing
// is held: the point is about where the SPRITE goes, not about what rides with it.
//
// THE VERDICT. At `sim.fraction` one half, a `32 x 32` gripper sprite is centered
// on the midpoint, and there is none on either hex it runs between.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNear,
  assertNotNull,
} from "../assert";
import {
  ARM_MIN_LEN,
  FRACTION_TOLERANCE,
  GRIPPER_SPRITE_SIZE,
  HEX_PITCH,
} from "../constants";
import { hexCenter, type StagePoint } from "../field";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceFraction,
  captureStill,
  createHarness,
  imagesNear,
  openBareRun,
  type DrawCall,
  type Harness,
  type ImageDraw,
} from "../harness";
import { gripperHex } from "../parts";

/** The piston stands at rotation `0`, so its one spoke is direction `0`. */
const SPOKE = 0;

/** The moment inside the cycle the point names. */
const HALF = 0.5;

/** How near a sprite's centre must land to count as drawn on a point. */
const ON_POINT = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The gripper-sized sprites a frame drew centred on a stage point. */
function grippersOn(calls: readonly DrawCall[], at: StagePoint): ImageDraw[] {
  return imagesNear(calls, at, ON_POINT).filter(
    (draw) =>
      draw.image.width === GRIPPER_SPRITE_SIZE &&
      draw.image.height === GRIPPER_SPRITE_SIZE,
  );
}

it("draws the gripper on the midpoint of the hex it is extending across", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("piston", ORIGIN.q, ORIGIN.r, 0, ARM_MIN_LEN, ["extend"]),
    ]),
  });

  await advanceFraction(h, HALF);
  await captureStill(h, "gripper-mid-extend");

  const midway = await h.snapshot();
  assertEqual(
    midway.sim?.status,
    "running",
    "the extend is under way rather than faulted: 1 to 2 is inside ARM_MIN_LEN to ARM_MAX_LEN",
  );
  assertNear(
    midway.sim?.fraction ?? -1,
    HALF,
    FRACTION_TOLERANCE,
    "the frame covered exactly half a cycle, so the motion stands at t = 1/2",
  );

  const from = hexCenter(gripperHex(ORIGIN, SPOKE, ARM_MIN_LEN));
  const to = hexCenter(gripperHex(ORIGIN, SPOKE, ARM_MIN_LEN + 1));
  const midpoint = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  assertNear(
    Math.hypot(to.x - from.x, to.y - from.y),
    HEX_PITCH,
    ON_POINT,
    "the gripper translates one hex along its spoke, which spans HEX_PITCH (48)",
  );

  const calls = await h.lastCalls();
  const halfway = grippersOn(calls, midpoint);
  assertLength(
    halfway,
    1,
    "one 32 x 32 gripper sprite is centered half way along the one-hex vector, " +
      "because the translation is linear in t and t is a half",
  );
  const draw = halfway[0];
  assertNotNull(draw, "the gripper's sprite was read off the frame");
  assertEqual(
    Math.round(Math.abs(draw?.dw ?? 0)),
    GRIPPER_SPRITE_SIZE,
    "drawn at its native canvas, so nothing is scaled at draw time",
  );

  assertLength(
    grippersOn(calls, from),
    0,
    "and none is left on the hex the gripper started the cycle on",
  );
  assertLength(
    grippersOn(calls, to),
    0,
    "and none has arrived on the hex it is bound for",
  );
});
