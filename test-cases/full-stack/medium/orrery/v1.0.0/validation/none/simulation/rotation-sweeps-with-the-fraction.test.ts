// simulation/rotation-sweeps-with-the-fraction — a rotation sweeps 60 times the
// fraction.
//
// THE RULE, from the motion table of `specs/simulation.md` (Motion and carrying):
// "`rotate-cw`, `rotate-ccw` — The part's direction turns 60 degrees about its
// base, clockwise or counterclockwise, sweeping `60 * t` degrees. | The same
// rotation about the base." The `t` is the cycle's own progress: "A cycle is one
// unit of simulated machine time. Its progress is `sim.fraction`, from `0` to `1`"
// (Cycles and the clock). And what a mote reports mid-cycle is that swept point:
// "x, y — the drawn position at the current fraction" (`specs/instrumentation.md`,
// Snapshot shape), derived from "its hex, its motion, and `sim.fraction`, by the
// formulas of `specs/field.md` and `specs/simulation.md`".
//
// WHICH WAY IS CLOCKWISE ON THE STAGE. `specs/field.md` places hex centers at
// `hexX(q, r) = FIELD_CX + HEX_PITCH * (q + r / 2)` and
// `hexY(q, r) = FIELD_CY + HEX_PITCH * (sqrt(3) / 2) * r`, so `y` grows DOWNWARD,
// and it turns the offset `(1, 0)` — due east of the base — into `(0, 1)` under
// one clockwise step. `(0, 1)`'s stage offset is `(HEX_PITCH / 2,
// HEX_PITCH * sqrt(3) / 2)`, which is 60 degrees round from due east in the
// direction of INCREASING angle when `y` grows downward. So a clockwise sweep is a
// positive angle in stage coordinates and a counterclockwise one is negative; both
// are read here, so a build that swept the wrong way round fails one of them.
//
// THE CONFIGURATION, posed twice — once clockwise and once counterclockwise. An
// `arm` on `(0, 0)` at rotation `0`, length `2`, so its gripper is `(2, 0)`
// ("one gripper per spoke at `base + length * DIRS[d]`", `specs/parts.md`), holding
// a constellation of two motes on `(2, 0)` and `(2, 1)` joined by one filament.
// The two sit at DIFFERENT distances and DIFFERENT bearings from the base, so the
// rule read is "its cycle-start position rotated about the part's base stage
// position by exactly `60 * t` degrees" rather than anything a single radius could
// stand in for. The pair stays one hex apart through the sweep, so nothing comes
// within the `38` the collision rule watches, and the field holds these two motes
// alone.
//
// THE EXPECTED POINT IS COMPUTED FROM THE FRACTION THE RUN REPORTS, because
// `sim.fraction` is one of the three figures `specs/instrumentation.md` carries as
// a running sum of the frames' own delta times, which "agree to within the
// rounding of that sum rather than bit for bit".
//
// THE VERDICT. Halfway through the cycle each mote stands on the 30 degree ray
// from the base through its own start — not on the hex it left and not on the hex
// it is heading for, each of which is more than `HEX_PITCH / 2` away.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertNear,
  assertNotNull,
} from "../assert";
import { FRACTION_TOLERANCE, HEX_PITCH } from "../constants";
import {
  at,
  distance,
  hexCenter,
  rotateAbout,
  type Hex,
  type StagePoint,
} from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceFraction,
  captureStill,
  createHarness,
  moteById,
  openBareRun,
  partIds,
  spawnConstellation,
  takeGrip,
  type Harness,
} from "../harness";

/** How near a drawn position must land: one fraction's worth of the sweep. */
const DRAWN_TOLERANCE = HEX_PITCH * FRACTION_TOLERANCE;

/** The arm's base, which every sweep below turns about. */
const BASE: Hex = at(0, 0);

/** The constellation's two hexes when the cycle begins. */
const START: readonly Hex[] = [at(2, 0), at(2, 1)];

/** Where the cycle is halted and read. */
const HALFWAY = 1 / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * `from` swept `degrees` about `center`, positive being clockwise on a stage whose
 * `y` grows downward.
 */
function swept(
  from: StagePoint,
  center: StagePoint,
  degrees: number,
): StagePoint {
  const angle = (degrees * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = from.x - center.x;
  const dy = from.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

/**
 * Pose the arm and its two-mote constellation, halt the cycle halfway, and read
 * each mote against the point `60 * t` degrees round from where it began.
 *
 * `turn` is `1` for `rotate-cw` and `-1` for `rotate-ccw`, which is the sign of
 * the swept angle in stage coordinates as the header derives it.
 */
async function sweepsSixtyTimesTheFraction(
  instruction: "rotate-cw" | "rotate-ccw",
  turn: 1 | -1,
): Promise<void> {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("arm", BASE.q, BASE.r, 0, 2, [instruction])]),
  });
  const arm = (await partIds(h))[0] ?? -1;
  const motes = await spawnConstellation(
    h,
    START.map((hex) => ({ hex, type: "dust" as const })),
    [{ a: 0, b: 1 }],
  );
  await takeGrip(h, arm, 0, motes[0] ?? -1);

  await advanceFraction(h, HALFWAY);
  await captureStill(h, "mid-sweep");

  const midway = await h.snapshot();
  assertEqual(
    midway.sim?.status,
    "running",
    `${instruction} carries a rigid pair one hex apart, so nothing collides mid-sweep`,
  );
  const fraction = midway.sim?.fraction ?? -1;
  assertNear(
    fraction,
    HALFWAY,
    FRACTION_TOLERANCE,
    `${instruction} is halted halfway through its cycle`,
  );

  const center = hexCenter(BASE);
  for (const [index, mote] of motes.entries()) {
    const from = START[index] as Hex;
    const begun = hexCenter(from);
    const ending = hexCenter(rotateAbout(from, BASE, turn));
    const expected = swept(begun, center, turn * 60 * fraction);
    const carried = moteById(midway, mote);
    assertNotNull(carried, `mote ${index} of the constellation is reported`);
    const reported = {
      x: carried?.x ?? Number.NaN,
      y: carried?.y ?? Number.NaN,
    };
    assertNear(
      reported.x,
      expected.x,
      DRAWN_TOLERANCE,
      `${instruction}: x is mote ${index}'s cycle-start position swept 60 * t degrees about the arm's base`,
    );
    assertNear(
      reported.y,
      expected.y,
      DRAWN_TOLERANCE,
      `${instruction}: y is mote ${index}'s cycle-start position swept 60 * t degrees about the arm's base`,
    );
    assertGreaterThan(
      distance(reported, begun),
      HEX_PITCH / 2,
      `${instruction}: at fraction 0.5 mote ${index} stands on the 30 degree ray rather than on the hex it left`,
    );
    assertGreaterThan(
      distance(reported, ending),
      HEX_PITCH / 2,
      `${instruction}: at fraction 0.5 mote ${index} stands on the 30 degree ray rather than on the hex it is heading for`,
    );
  }
}

it("stands a carried mote on the 30 degree ray at fraction 0.5, either way round", async () => {
  await sweepsSixtyTimesTheFraction("rotate-cw", 1);
  await sweepsSixtyTimesTheFraction("rotate-ccw", -1);
});
