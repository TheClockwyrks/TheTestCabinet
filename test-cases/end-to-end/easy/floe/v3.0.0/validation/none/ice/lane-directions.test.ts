// ice/lane-directions — each ice lane runs the way its row of the lane table
// says, and its vehicles really travel that way.
//
// specs/ice.md gives every lane a `dir`, "`1` for a lane running rightward
// (increasing `x`) and `-1` for a lane running leftward", and states what it
// does: "A lane at speed `s` and direction `d` moves every one of its vehicles
// by `d * s * TILE` units per second of game time." The table alternates the
// eight — `-1, 1, -1, 1, -1, 1, -1, 1` from row 11 down to row 18 — which is the
// whole reason the band can be crossed at all.
//
// TWO READINGS, BOTH IN THE SAME DIRECTION. The reported `dir` on each of the
// eight lanes, and the SIGN of a vehicle's displacement over a second of game
// time. Nothing here reads how FAR it went: `ice/lane-speeds` grades the rate,
// and a bound on the distance here would fail a build for a wrong speed twice.
// The displacement is required to be strictly the lane's own way, which fails a
// build that runs the lane backwards and equally a build whose lanes do not move
// at all.
//
// THE LEVEL'S OWN TRAFFIC IS WHAT IS WATCHED. The requirement is a property of
// the lanes a level lays down, so nothing is cleared and nothing is posed: one
// vehicle per lane is followed by its id, chosen at the middle of the strait so
// that no wrap can land inside the second being measured (see
// `midStraitVehicle`).

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDefined,
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
} from "../assert";
import { ICE_LANES } from "../constants";
import {
  captureReplay,
  createHarness,
  laneAt,
  requireItem,
  ticksFor,
  type Harness,
} from "../harness";
import { layOutLevel, midStraitVehicle } from "./harness";

/** The level laid out. The table's directions are the same at every level. */
const LEVEL = 1;

/**
 * The game time the displacement is measured over, in seconds.
 *
 * The figure the item is stated in ("a vehicle's x moves that way over a
 * second"), and long enough that the slowest ice lane — `1.5` tiles a second —
 * covers `48` units, which no reading of a lane running the other way could be
 * confused with.
 */
const MEASURED_SECONDS = 1;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("reports each ice lane's stated direction and moves its vehicles that way", async () => {
  const laid = await layOutLevel(harness, LEVEL);

  // The table's own reading: what each lane says it does.
  for (const lane of ICE_LANES) {
    const reported = laneAt(laid, lane.row);
    assertDefined(reported, `row ${lane.row}: an ice lane on that row`);
    assertEqual(reported?.dir, lane.dir, `row ${lane.row}: dir`);
  }

  // One vehicle per lane, followed by id across the second below.
  const followed = new Map<number, { id: number; x: number }>();
  for (const lane of ICE_LANES) {
    const vehicle = midStraitVehicle(laid, lane.row);
    assertDefined(
      vehicle,
      `row ${lane.row}: a vehicle to follow (specs/ice.md: a lane always ` +
        `carries enough vehicles to reach both edges of the strait)`,
    );
    if (vehicle !== undefined) {
      followed.set(lane.row, { id: vehicle.id, x: vehicle.x });
    }
  }

  const after = await captureReplay(harness, "slide", async () => {
    await harness.advance(ticksFor(MEASURED_SECONDS));
    return harness.snapshot();
  });

  for (const lane of ICE_LANES) {
    const start = followed.get(lane.row);
    if (start === undefined) continue;
    const moved = requireItem(
      after,
      start.id,
      `following the vehicle on row ${lane.row} for ${MEASURED_SECONDS} s`,
    );
    assertGreaterThan(
      lane.dir * (moved.x - start.x),
      0,
      `row ${lane.row}: the distance a vehicle covered in ${MEASURED_SECONDS} s ` +
        `towards the lane's own direction (dir ${lane.dir}), from x ${start.x}`,
    );
  }

  // Nothing the page threw or logged as an error while this harness drove it.
  assertDeepEqual(harness.pageErrors, []);
});
