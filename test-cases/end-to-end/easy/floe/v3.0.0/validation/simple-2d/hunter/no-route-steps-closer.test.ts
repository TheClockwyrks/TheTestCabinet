// hunter/no-route-steps-closer — with no open route to its target, a bear still
// steps to the open neighbour that most shortens the distance.
//
// specs/hunter.md gives the routing rule three branches, and this is the second:
//
//   2. Where no such route exists, the step into whichever open neighboring tile
//      is least far from the target in tile distance.
//
// A build that implements only the first branch stands still here, which is the
// THIRD branch's behaviour in a situation that does not call for it — so a build
// that passes `routes-around-hazard` and `pursues` can still fail this, and that
// is the grading this item exists to produce.
//
// THE POSE MAKES THE RIGHT ANSWER UNIQUE. The target's whole row is sealed by
// parked vehicles, so the target tile itself is closed and no open route to it
// exists at all. From the bear's tile the four neighbours are at tile distances
// 2 (up), 4 (down), 4 (left) and 4 (right), so exactly one of them "most shortens
// that route" — and standing still, stepping down, and stepping sideways each read
// as a different, named answer.
//
// The bear's TRAVEL is off, so the step it committed is read with nothing moving:
// what is graded is the choice, not the journey. Its SENSE is off and its target
// is posed, so the tile it hunts is the sealed one rather than wherever the
// critter happens to be.

import { afterEach, beforeEach, it } from "vitest";
import { COLS, ITEM_LEN, ROW_NEAR } from "../../src/constants";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  bearOf,
  captureReplay,
  createHarness,
  poseBear,
  poseLane,
  startCrossing,
  type Harness,
} from "../harness";
import { bearStepTile, vehicleCoversTile } from "./harness";

/** The sealed row, which is the target's row, and the target on it. */
const SEALED_ROW = 15;
const TARGET = { col: 20, row: SEALED_ROW };

/** The bear, three rows below the seal and in the target's column. */
const BEAR_COL = 20;
const BEAR_ROW = ROW_NEAR - 1;

/** A car every two columns seals the row end to end: 40 columns, 20 cars. */
const SEAL_COLS = Array.from(
  { length: COLS / ITEM_LEN.car },
  (_, index) => index * ITEM_LEN.car,
);

/**
 * The neighbour the rule names.
 *
 * From (20, 18) toward (20, 15): up is 2 away, down is 4, and either side is 4.
 * The row above the bear is empty, so that neighbour is open.
 */
const CLOSEST_NEIGHBOUR = { col: BEAR_COL, row: BEAR_ROW - 1 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("steps into the open neighbour least far from a target no route reaches", async () => {
  startCrossing(h);
  poseLane(h, SEALED_ROW, "car", SEAL_COLS);
  const id = poseBear(h, BEAR_COL, BEAR_ROW, { sense: false, travel: false });
  h.debug.setBearTarget(id, TARGET.col, TARGET.row);

  // The scenario this check needs, read off the game itself: the seal really does
  // close the target's whole row, so no open route to the target exists and the
  // rule's SECOND branch is the one in play; and the neighbour the rule names
  // really is open, so there is a right answer to give.
  const posed = h.snapshot();
  const unsealed = Array.from({ length: COLS }, (_unused, col) => col).filter(
    (col) => !vehicleCoversTile(posed, col, SEALED_ROW),
  );
  assertDeepEqual(
    unsealed,
    [],
    `columns of row ${SEALED_ROW} no vehicle covers, the seal being what ` +
      `leaves no open route to (${TARGET.col}, ${TARGET.row})`,
  );
  assertEqual(
    vehicleCoversTile(posed, CLOSEST_NEIGHBOUR.col, CLOSEST_NEIGHBOUR.row),
    false,
    `a vehicle over the neighbour the rule names ` +
      `(${CLOSEST_NEIGHBOUR.col}, ${CLOSEST_NEIGHBOUR.row})`,
  );
  assertDeepEqual(
    bearOf(posed, id).target,
    TARGET,
    "the tile the bear was posed hunting",
  );

  const chosen = await captureReplay(h, "route", async () => {
    await h.advance(1);
    return h.snapshot();
  });

  assertDeepEqual(
    bearStepTile(bearOf(chosen, id)),
    CLOSEST_NEIGHBOUR,
    `the tile a bear at (${BEAR_COL}, ${BEAR_ROW}) steps into with no open ` +
      `route to (${TARGET.col}, ${TARGET.row})`,
  );
});
