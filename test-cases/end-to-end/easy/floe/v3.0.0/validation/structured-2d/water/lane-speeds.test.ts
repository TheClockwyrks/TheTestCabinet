// Floe — water/lane-speeds: each water lane drifts at the speed its row of the
// lane table gives it, and its floes really cover that ground.
//
// specs/water.md states speed "in tiles per second at level 1" and fixes the
// eight figures — `3.3, 3.5, 4.2, 3.6, 3.2, 3.8, 3.4, 3.0` from row 2 down to
// row 9 — and then fixes what a speed MEANS: "A lane at speed `s` and direction
// `d` moves every one of its floes by `d * s * TILE` units per second of game
// time."
//
// TWO READINGS, ONE REQUIREMENT. The number each lane reports, and the ground a
// floe actually covers in a second. They are two halves of the same rule and
// they fail independently: a build can report `4.2` and drift at `1.0`, or move
// correctly and report nothing like it. Neither reading is taken from the other
// — the distance is compared against the TABLE's figure, not against the build's
// reported one, so a build that is consistently wrong is still wrong.
//
// THE DIRECTION IS NOT READ HERE; `water/lane-directions` grades that. The
// distance is taken as an absolute value so a lane drifting the wrong way fails
// there and only there.
//
// THE LEVEL'S OWN TRAFFIC IS WHAT IS WATCHED, for the reason `midStraitFloe`
// gives: a lane's speed is a property of the level as it was laid out, and a
// floe taken from the middle of the strait cannot wrap inside the second being
// measured, so the displacement is travel rather than a jump.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertLessThanOrEqual } from "../assert";
import { TILE, WATER_LANES, laneSpeed } from "../constants";
import {
  captureReplay,
  createHarness,
  floeById,
  laneAt,
  ticksFor,
  type Harness,
} from "../harness";
import { layOutLevel, midStraitFloe } from "./harness";

/** The level laid out: the table's figures are its level-1 ones. */
const LEVEL = 1;

/**
 * How far a reported speed may sit from the table's figure, in tiles a second.
 *
 * The closest figures in the level-1 table are a tenth of a tile a second apart
 * — `3.3` and `3.4`, `3.5` and `3.6` — so a hundredth of a tile a second still
 * names which lane's figure a build reached for, a tenth of that separation,
 * while leaving a build room to arrive at `3.3` by computing
 * `3.3 * LEVEL_SPEED_STEP ^ 0` rather than writing it down.
 */
const REPORTED_SPEED_TOLERANCE = 0.01;

/** The game time the ground covered is measured over, in seconds. */
const MEASURED_SECONDS = 1;

/**
 * How far the ground covered may sit from `speed * TILE`, as a fraction.
 *
 * The two per cent the item is stated at. The tightest lane it has to separate
 * is row 5 at `3.6` tiles a second: two per cent of its `115.2` units is `2.3`,
 * and the nearest wrong figure in the table — the `3.5` on row 3 — is `3.2`
 * units away over the same second, so even there the bound is comfortably
 * narrower than the gap between two lanes' speeds. On row 9 at `3.0`, whose
 * nearest neighbour is `3.2`, it is narrower by more than three times.
 */
const COVERED_TOLERANCE_FRACTION = 0.02;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("drifts each water lane at its level-1 table speed, in report and in ground covered", async () => {
  const laid = await layOutLevel(h, LEVEL);

  // What each lane says it drifts at.
  for (const lane of WATER_LANES) {
    const reported = laneAt(laid, lane.row);
    assertDefined(reported, `row ${lane.row}: a water lane on that row`);
    if (reported === undefined) continue;
    const stated = laneSpeed(lane.row, LEVEL);
    assertLessThanOrEqual(
      Math.abs(reported.speed - stated),
      REPORTED_SPEED_TOLERANCE,
      `row ${lane.row}: reported speed away from ${stated} tiles a second, ` +
        `was ${reported.speed}`,
    );
  }

  // One floe per lane, followed by id across the second below.
  const followed = new Map<number, { id: number; x: number }>();
  for (const lane of WATER_LANES) {
    const floe = midStraitFloe(laid, lane.row);
    assertDefined(
      floe,
      `row ${lane.row}: a floe to follow (specs/water.md: a lane always ` +
        `carries enough floes to reach both edges of the strait)`,
    );
    if (floe !== undefined) {
      followed.set(lane.row, { id: floe.id, x: floe.x });
    }
  }

  const after = await captureReplay(h, "drift", async () => {
    await h.advance(ticksFor(MEASURED_SECONDS));
    return h.snapshot();
  });

  for (const lane of WATER_LANES) {
    const start = followed.get(lane.row);
    if (start === undefined) continue;
    const moved = floeById(after, start.id);
    assertDefined(
      moved,
      `row ${lane.row}: the floe followed across ${MEASURED_SECONDS} s is ` +
        `still on the strait under the id it kept (specs/instrumentation.md)`,
    );
    if (moved === undefined) continue;
    const expected = laneSpeed(lane.row, LEVEL) * TILE * MEASURED_SECONDS;
    const covered = Math.abs(moved.x - start.x);
    assertLessThanOrEqual(
      Math.abs(covered - expected),
      COVERED_TOLERANCE_FRACTION * expected,
      `row ${lane.row}: the ground a floe covered in ${MEASURED_SECONDS} s ` +
        `away from ${expected} units, was ${covered}`,
    );
  }
});
