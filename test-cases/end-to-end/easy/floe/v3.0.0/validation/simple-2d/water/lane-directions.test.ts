// water/lane-directions — each water lane drifts the way its row of the lane
// table says, and its floes really travel that way.
//
// specs/water.md gives every lane a `dir`, "`1` for a lane drifting rightward
// (increasing `x`) and `-1` for a lane drifting leftward", and states what it
// does: "A lane at speed `s` and direction `d` moves every one of its floes by
// `d * s * TILE` units per second of game time." The table alternates the eight
// — `-1, 1, -1, 1, -1, 1, -1, 1` from row 2 down to row 9 — which is the whole
// reason the band can be crossed at all.
//
// TWO READINGS, BOTH IN THE SAME DIRECTION. The reported `dir` on each of the
// eight lanes, and the SIGN of a floe's displacement over a second of game time.
// Nothing here reads how FAR it went: `water/lane-speeds` grades the rate, and a
// bound on the distance here would fail a build for a wrong speed twice. The
// displacement is required to be strictly the lane's own way, which fails a
// build that drifts the lane backwards and equally a build whose lanes do not
// move at all.
//
// THE LEVEL'S OWN FLOES ARE WHAT IS WATCHED. The requirement is a property of
// the lanes a level lays down, so nothing is cleared and nothing is posed: one
// floe per lane is followed by its id, chosen at the middle of the strait so
// that no wrap can land inside the second being measured (see `midStraitFloe`).

import { afterEach, beforeEach, it } from "vitest";
import { WATER_LANES } from "../../src/constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  floeOf,
  laneAt,
  ticksFor,
  type Harness,
} from "../harness";
import { layOutLevel, midStraitFloe } from "./harness";

/** The level laid out. The table's directions are the same at every level. */
const LEVEL = 1;

/**
 * The game time the displacement is measured over, in seconds.
 *
 * The figure the item is stated in ("a floe's x moves that way over a second"),
 * and long enough that the slowest water lane — `3.0` tiles a second — covers
 * `96` units, which no reading of a lane drifting the other way could be
 * confused with.
 */
const MEASURED_SECONDS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports each water lane's stated direction and drifts its floes that way", async () => {
  const laid = await layOutLevel(h, LEVEL);

  // The table's own reading: what each lane says it does.
  for (const lane of WATER_LANES) {
    assertEqual(laneAt(laid, lane.row).dir, lane.dir, `row ${lane.row}: dir`);
  }

  // One floe per lane, followed by id across the second below.
  const followed = WATER_LANES.map((lane) => {
    const floe = midStraitFloe(laid, lane.row);
    return { row: lane.row, dir: lane.dir, id: floe.id, x: floe.x };
  });

  const after = await captureReplay(h, "drift", async () => {
    await h.advance(ticksFor(MEASURED_SECONDS));
    return h.snapshot();
  });

  for (const start of followed) {
    const moved = floeOf(after, start.id);
    assertGreaterThan(
      start.dir * (moved.x - start.x),
      0,
      `row ${start.row}: the distance a floe covered in ` +
        `${MEASURED_SECONDS} s towards the lane's own direction ` +
        `(dir ${start.dir}), from x ${start.x}`,
    );
  }
});
