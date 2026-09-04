// instrumentation/snapshot-mote-position-at-fraction — a mote reports the hex it
// last rested on and the point it is drawn at now.
//
// THE RULE. `specs/instrumentation.md`, Snapshot shape, annotates the two pairs
// where it declares them: "{ id, q, r, // the hex at the last boundary" and
// "x: <number>, y: <number>, // the drawn position at the current fraction". The
// derivation table names both sources: "a mote's `x`, `y` — its hex, its motion,
// and `sim.fraction`, by the formulas of `specs/field.md` and
// `specs/simulation.md`". `specs/state.md` says the same of the state behind it:
// "`q` and `r` are the mote's hex at the last boundary; a mote's drawn mid-cycle
// position is derived from its motion and `fraction`."
//
// THE FORMULAS. `specs/field.md` fixes the center of a hex,
// `hexX(q, r) = FIELD_CX + HEX_PITCH * (q + r / 2)` and
// `hexY(q, r) = FIELD_CY + HEX_PITCH * (sqrt(3) / 2) * r`, which `field.ts` carries
// as `hexCenter`. `specs/simulation.md` fixes the motion: under `rotate-cw` "the
// part's direction turns 60 degrees about its base... sweeping `60 * t` degrees",
// and "A carried constellation moves as one rigid body: every mote of it follows
// the motion". So a mote carried by an arm of length 1 at `(0, 0)` from `(1, 0)`
// is drawn, at fraction `t`, on the circle of radius `HEX_PITCH` about the base,
// `60 * t` degrees clockwise from due east — which lands exactly on the center of
// `(0, 1)` at `t = 1`, as the rule requires.
//
// THE CONFIGURATION. That arm, that carried mote, and one resting mote three rows
// south, far outside the `38` the collision rule watches, so nothing faults and
// the check has both readings in one snapshot: a mote in motion and a mote at
// rest. The run is stopped a fraction of the way through the first cycle, and the
// expected position is computed from the fraction the run REPORTS, because
// `sim.fraction` is one of the three figures `specs/instrumentation.md` carries as
// a running sum that agrees "to within the rounding of that sum rather than bit for
// bit".
//
// THE VERDICT. Mid-cycle, the carried mote still reports `(1, 0)` — the hex it held
// at the last boundary, not the one it is heading for — while its `x` and `y` are
// the swept point at that fraction; the resting mote reports its own hex and its
// own center. At the boundary both report the hexes they came to rest on.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNotNull } from "../assert";
import {
  FIELD_CX,
  FIELD_CY,
  FRACTION_TOLERANCE,
  HEX_PITCH,
} from "../constants";
import { at, hexCenter } from "../field";
import { BARE, SOUTH } from "../fixtures";
import { armPart, solution } from "../formats";
import {
  advanceFraction,
  captureReplay,
  createHarness,
  moteById,
  openBareRun,
  partIds,
  spawnMote,
  takeGrip,
  type Harness,
} from "../harness";

/** How near a drawn position must land: one fraction's worth of the sweep. */
const DRAWN_TOLERANCE = HEX_PITCH * FRACTION_TOLERANCE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the boundary hex and the swept position at the current fraction", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("arm", 0, 0, 0, 1, ["rotate-cw"])]),
  });
  const arm = (await partIds(h))[0] ?? -1;
  const carried = await spawnMote(h, at(1, 0), "dust");
  await takeGrip(h, arm, 0, carried);
  const resting = await spawnMote(h, SOUTH, "dust");

  await captureReplay(h, "carried", () => advanceFraction(h, 3 / 8));

  const midway = await h.snapshot();
  const fraction = midway.sim?.fraction ?? -1;
  assertNear(
    fraction,
    3 / 8,
    FRACTION_TOLERANCE,
    "the run is three eighths of the way through its first cycle",
  );

  const swept = moteById(midway, carried);
  assertNotNull(swept, "the carried mote is reported");
  assertEqual(
    swept?.q,
    1,
    "a carried mote reports the hex it held at the last boundary",
  );
  assertEqual(
    swept?.r,
    0,
    "a carried mote reports the hex it held at the last boundary",
  );
  const turned = (Math.PI / 3) * fraction;
  assertNear(
    swept?.x ?? Number.NaN,
    FIELD_CX + HEX_PITCH * Math.cos(turned),
    DRAWN_TOLERANCE,
    "x is the point 60 * t degrees clockwise of due east about the arm's base",
  );
  assertNear(
    swept?.y ?? Number.NaN,
    FIELD_CY + HEX_PITCH * Math.sin(turned),
    DRAWN_TOLERANCE,
    "y is the point 60 * t degrees clockwise of due east about the arm's base",
  );

  const still = moteById(midway, resting);
  assertNotNull(still, "the resting mote is reported");
  assertEqual(still?.q, SOUTH.q, "a mote held by nothing rests on its hex");
  assertEqual(still?.r, SOUTH.r, "a mote held by nothing rests on its hex");
  assertNear(
    still?.x ?? Number.NaN,
    hexCenter(SOUTH).x,
    DRAWN_TOLERANCE,
    "a resting mote is drawn on its hex's center",
  );
  assertNear(
    still?.y ?? Number.NaN,
    hexCenter(SOUTH).y,
    DRAWN_TOLERANCE,
    "a resting mote is drawn on its hex's center",
  );

  await advanceFraction(h, 5 / 8);
  const landed = await h.snapshot();
  const arrived = moteById(landed, carried);
  assertEqual(landed.sim?.cycle, 1, "the cycle reached its boundary");
  assertEqual(
    arrived?.q,
    0,
    "at the boundary the carried mote reports its new hex",
  );
  assertEqual(
    arrived?.r,
    1,
    "at the boundary the carried mote reports its new hex",
  );
  assertNear(
    arrived?.x ?? Number.NaN,
    hexCenter(at(0, 1)).x,
    DRAWN_TOLERANCE,
    "at t = 1 every mote lands exactly on a hex center",
  );
  assertNear(
    arrived?.y ?? Number.NaN,
    hexCenter(at(0, 1)).y,
    DRAWN_TOLERANCE,
    "at t = 1 every mote lands exactly on a hex center",
  );
});
