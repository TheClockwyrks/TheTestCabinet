// hunter/floe-speed — a bear crossing a floe travels at its ICE speed.
//
// specs/hunter.md: "A bear's footing is the footing of the tile it is travelling
// into. It is `swimming` when that tile is on the water band and NO FLOE COVERS
// IT, and on ice otherwise: the near shore, the ice band, the median, the far
// shore, and any water tile a floe covers are all ice footing." So the water band
// is not itself the swim speed — the open water is — and a bear crossing a raft
// reads `bearIceSpeed`, not `bearSwimSpeed`.
//
// The two figures are 96 and 64 units a second at level 1, half as far apart
// again as the 2% allowance, so a build that reads the BAND rather than the
// COVERING fails here by a third and names which of the two models it built.
//
// The raft is PARKED (`poseLane` stops the lane before laying it), so the reading
// is the bear's rate and not the bear's rate plus the lane's drift, and the tile
// it is measured over stays covered for the whole measurement.

import { afterEach, beforeEach, it } from "vitest";
import { ITEM_LEN, TILE, bearIceSpeed } from "../../src/constants";
import { assertBetween } from "../assert";
import {
  captureReplay,
  createHarness,
  poseBear,
  poseLane,
  speedOverTicks,
  startCrossing,
  type Harness,
} from "../harness";
import { travelOverTicks } from "./harness";

/** A row of the water band, and where the run starts on it. */
const WATER_ROW = 6;
const FROM_COL = 5;

/**
 * The rafts laid under the run, by the column each one's left edge sits on.
 *
 * Two `raft4`s laid end to end cover eight consecutive columns from `FROM_COL - 1`,
 * so both the tile the bear stands on and the tile it steps into are floe footing
 * whatever the build's rate turns out to be.
 */
const RAFT_COLS = [FROM_COL - 1, FROM_COL - 1 + ITEM_LEN.raft4];

/** The level the figure is stated at. */
const LEVEL = 1;

/** The ticks the rate is measured over, as `ice-speed` derives them. */
const MEASURE_TICKS = 20;

/** The allowance `ice-speed` states around the same figure. */
const SPEED_TOLERANCE = 0.02;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("travels at the ice speed over a water row a raft covers", async () => {
  startCrossing(h, LEVEL);
  poseLane(h, WATER_ROW, "raft4", RAFT_COLS);
  const id = poseBear(h, FROM_COL, WATER_ROW, {
    sense: false,
    routing: false,
  });

  const covered = await captureReplay(h, "swim", () =>
    travelOverTicks(h, id, "right", MEASURE_TICKS),
  );

  const expected = bearIceSpeed(LEVEL) * TILE;
  assertBetween(
    speedOverTicks(covered, MEASURE_TICKS),
    expected * (1 - SPEED_TOLERANCE),
    expected * (1 + SPEED_TOLERANCE),
    `stage units a second over a floe at level ${LEVEL}`,
  );
});
