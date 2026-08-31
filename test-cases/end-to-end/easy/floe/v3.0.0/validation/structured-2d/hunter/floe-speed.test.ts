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
// is the bear's rate and not the bear's rate plus the lane's drift, and the tiles
// it is measured over stay covered for the whole measurement.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual } from "../assert";
import { ITEM_LEN, TILE, bearIceSpeed } from "../../src/constants";
import {
  captureReplay,
  createHarness,
  floesOn,
  itemCoversTile,
  poseBear,
  poseLane,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";
import { speedOverTicks, stepAcross } from "./harness";

/** A row of the water band, and where the run starts on it. */
const WATER_ROW = 6;
const FROM_COL = 5;

/**
 * The rafts laid under the run, by the column each one's left edge sits on.
 *
 * Two `raft4`s laid end to end cover eight consecutive columns from `FROM_COL - 1`,
 * which is four tiles of clear margin past the three a level-1 bear covers in the
 * second measured — so a build up to twice too fast is still measured over floe.
 */
const RAFT_COLS = [FROM_COL - 1, FROM_COL - 1 + ITEM_LEN.raft4];

/** The level the figure is stated at. */
const LEVEL = 1;

/** The game time measured over. */
const MEASURE_SECONDS = 1;

/** The allowance `ice-speed` states around the same figure. */
const SPEED_TOLERANCE = 0.02;

/**
 * How many columns past `FROM_COL` the measurement is required to be over floe.
 *
 * A level-1 bear covers three tiles in the second measured, and the two rafts
 * cover eight columns from `FROM_COL - 1`, so six is comfortably inside the span
 * and comfortably past where a build twice too fast would get to.
 */
const MEASURED_COLS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("travels at the ice speed over a water row a raft covers", async () => {
  startCrossing(h, LEVEL);
  poseLane(h, WATER_ROW, "raft4", RAFT_COLS);
  const id = poseBear(h, FROM_COL, WATER_ROW, {
    sense: false,
    routing: false,
  });

  // The scenario this check needs, read off the game itself: every tile the run
  // is measured over really is covered by a floe, so the footing under the whole
  // measurement is the one the rule calls ice.
  const rafts = floesOn(h.snapshot(), WATER_ROW);
  for (let col = FROM_COL; col <= FROM_COL + MEASURED_COLS; col += 1) {
    assertEqual(
      rafts.some((raft) => itemCoversTile(raft, col)),
      true,
      `a floe over water tile (${col}, ${WATER_ROW}), which is what makes it ` +
        `ice footing (specs/hunter.md)`,
    );
  }

  const ticks = ticksFor(MEASURE_SECONDS);
  const covered = await captureReplay(h, "swim", () =>
    stepAcross(h, id, "right", ticks),
  );

  const expected = bearIceSpeed(LEVEL) * TILE;
  assertBetween(
    speedOverTicks(covered, ticks),
    expected * (1 - SPEED_TOLERANCE),
    expected * (1 + SPEED_TOLERANCE),
    `stage units a second over a floe at level ${LEVEL}`,
  );
});
