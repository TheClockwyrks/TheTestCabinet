// presentation/arm-shaft-follows-its-live-angle — half way through a sweep the
// shaft stands at the angle the arm stands at, not at either end of the sweep.
//
// THE RULE. "An arm's shaft and spokes are drawn at the angle and the length the
// arm stands at on the frame, both of which change continuously within a cycle as
// `specs/simulation.md` defines" (`specs/assets.md`, What stays drawn in code).
// The motion is that file's own: `rotate-cw` turns "60 degrees about its base,
// clockwise ... sweeping `60 * t` degrees", where `t` is `sim.fraction`, "from `0`
// to `1`".
//
// SO AT `t = 1/2` THE SHAFT STANDS AT `30` DEGREES. `specs/field.md` indexes
// `DIRS` "in clockwise order on the stage starting from east", so an arm at
// rotation `0` starts along the `+x` axis and a clockwise sweep of `30` degrees
// puts it on the ray `30` degrees round from it — between the two hex directions
// and along neither: `DIRS[0]` at `0` degrees is where it began and `DIRS[1]` at
// `60` is where it will land.
//
// THE READING. Three rays out of the base are sampled at two distances apiece,
// `HEX_PITCH` (`48`) and `72` units out — both inside the shaft of a length-`2`
// arm, whose gripper stands `96` units away, and both clear of the `40`-unit hub
// on the base and the `32`-unit gripper at the far end. The `30` degree ray must
// be painted and the `0` and `60` degree rays must be as bare as the empty field
// left them, so a build that snapped the shaft to a hex direction, or that drew it
// at the pose the cycle started or will end at, fails whichever of the two it drew.
//
// THE FRACTION IS DRIVEN, NOT WAITED FOR. `advanceFraction` runs one frame of
// exactly half a cycle of game time at the run's own speed, so the frame that drew
// is the frame at `t = 1/2`; `sim.fraction` is read back to `FRACTION_TOLERANCE`,
// which is how `specs/instrumentation.md` says a running sum is compared.
//
// THE WORLD IS ONE ARM. The bare opener clears the field, so the arm turns
// carrying nothing and no mote, fixture or second part can be what a ray found.
//
// THE VERDICT. At `sim.fraction` `0.5` of a `rotate-cw`, the `30` degree ray out
// of the base is drawn and the `0` and `60` degree rays are not.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertGreaterThan,
  assertLessThanOrEqual,
  assertNear,
} from "../assert";
import { FRACTION_TOLERANCE, HEX_PITCH } from "../constants";
import { hexCenter } from "../field";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceFraction,
  captureStill,
  CHANNEL_EPSILON,
  colorDistance,
  createHarness,
  openBareRun,
  sampleColor,
  type Harness,
  type Rgb,
} from "../harness";

/** The length the arm sweeps at: its gripper stands `2 * HEX_PITCH` out. */
const LENGTH = 2;

/** How far along the sweep the shaft is read. */
const HALF_WAY = 0.5;

/** Where the shaft stands at `HALF_WAY` of a `rotate-cw` from rotation `0`. */
const SWEPT_DEGREES = 30;

/** The two distances out of the base each ray is read at. */
const DISTANCES = [HEX_PITCH, 72];

/** Where a ray reaches, `distance` units from the base at `degrees` clockwise. */
function ray(degrees: number, distance: number): { x: number; y: number } {
  const base = hexCenter(ORIGIN);
  const radians = (degrees * Math.PI) / 180;
  return {
    x: base.x + Math.cos(radians) * distance,
    y: base.y + Math.sin(radians) * distance,
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

async function readRay(degrees: number): Promise<Rgb[]> {
  const read: Rgb[] = [];
  for (const distance of DISTANCES) {
    const point = ray(degrees, distance);
    read.push(await sampleColor(h, point.x, point.y, 2));
  }
  return read;
}

it("draws the shaft along the 30 degree ray half way through a rotate-cw", async () => {
  // The bare field first: what each of the three rays looks like with nothing on
  // it, which is what "not drawn" is read against.
  await openBareRun(h, { challenge: BARE });
  await h.advance(1);
  const bare = new Map<number, Rgb[]>();
  for (const degrees of [0, SWEPT_DEGREES, 60]) {
    bare.set(degrees, await readRay(degrees));
  }

  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", ORIGIN.q, ORIGIN.r, 0, LENGTH, ["rotate-cw"]),
    ]),
  });
  await advanceFraction(h, HALF_WAY);
  await captureStill(h, "shaft-mid-sweep");

  assertNear(
    (await h.snapshot()).sim?.fraction ?? -1,
    HALF_WAY,
    FRACTION_TOLERANCE,
    "the frame that drew is the frame half way through the cycle, where the sweep has covered 60 * 0.5 = 30 degrees",
  );

  for (const degrees of [0, SWEPT_DEGREES, 60]) {
    const drawn = await readRay(degrees);
    const from = bare.get(degrees) as Rgb[];
    for (const [index, distance] of DISTANCES.entries()) {
      const moved = colorDistance(from[index] as Rgb, drawn[index] as Rgb);
      if (degrees === SWEPT_DEGREES) {
        assertGreaterThan(
          moved,
          CHANNEL_EPSILON,
          `the shaft is drawn along the ${SWEPT_DEGREES} degree ray ${distance} units from the base, which is where a rotate-cw stands at sim.fraction 0.5`,
        );
      } else {
        assertLessThanOrEqual(
          moved,
          CHANNEL_EPSILON,
          `nothing is drawn along the ${degrees} degree ray ${distance} units from the base, so the shaft follows the live pose rather than either endpoint's direction`,
        );
      }
    }
  }
});
