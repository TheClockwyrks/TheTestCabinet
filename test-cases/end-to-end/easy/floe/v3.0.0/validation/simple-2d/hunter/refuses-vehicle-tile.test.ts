// hunter/refuses-vehicle-tile — a step into a tile a vehicle covers is refused,
// and costs the bear nothing.
//
// specs/hunter.md: a tile covered by a vehicle is CLOSED to a bear, and "A step
// into a closed tile is refused: the bear stays settled where it is, on the strait
// and unharmed, and chooses again on the next tick." The step is sent with
// `setBearStep`, which `specs/instrumentation.md` says consults no route and meets
// exactly the refusal a routed step meets — so this reads the REFUSAL itself
// rather than a route that happened to avoid the tile.
//
// The vehicle is PARKED. A bear is taken off the strait by a vehicle in a lane
// whose speed is above `0`, so a moving one would confuse "the step was refused"
// with "the bear was removed"; parked, the two readings come apart and the item's
// "on the strait and unharmed" is what is read.
//
// The bear's sense and routing are off, so the only step it ever has is the one
// this check sent it. What is left after a second of game time is a bear settled
// exactly where it was posed.

import { afterEach, beforeEach, it } from "vitest";
import { tileCX, tileCY } from "../constants";
import { assertDeepEqual, assertEqual, assertLessThanOrEqual } from "../assert";
import {
  bearOf,
  captureReplay,
  createHarness,
  poseBear,
  poseLane,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";
import { bearStepTile, bearTile, vehicleCoversTile } from "./harness";

/** The row the vehicle is parked on, the bear's tile, and the vehicle's. */
const ROW = 15;
const BEAR_COL = 20;
/** A `car` is two tiles long, so parked here it covers the bear's right neighbour. */
const CAR_COL = BEAR_COL + 1;

/** The game time the refused step is left standing for. */
const HOLD_SECONDS = 1;

/**
 * How far the bear's centre may be from its tile's centre, in stage units.
 *
 * A refused step leaves the bear settled, and a settled bear's centre IS its
 * tile's centre, so the only allowance is arithmetic: a hundredth of a unit is
 * three thousandths of a tile.
 */
const CENTRE_TOLERANCE = 0.01;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a step into a parked vehicle and leaves the bear where it stood", async () => {
  startCrossing(h);
  poseLane(h, ROW, "car", [CAR_COL]);
  const id = poseBear(h, BEAR_COL, ROW, { sense: false, routing: false });

  // The scenario this check needs, read off the game itself: the tile the step is
  // sent into really is covered, and the tile the bear stands on really is not. A
  // bear left standing on an uncovered strait would be a refusal of nothing.
  const posed = h.snapshot();
  assertEqual(
    vehicleCoversTile(posed, BEAR_COL + 1, ROW),
    true,
    `a vehicle over the tile the step is sent into (${BEAR_COL + 1}, ${ROW}), ` +
      `which is what closes it (specs/hunter.md)`,
  );
  assertEqual(
    vehicleCoversTile(posed, BEAR_COL, ROW),
    false,
    `a vehicle over the tile the bear stands on (${BEAR_COL}, ${ROW})`,
  );

  const after = await captureReplay(h, "refuse", async () => {
    h.debug.setBearStep(id, "right");
    await h.advance(ticksFor(HOLD_SECONDS));
    return h.snapshot();
  });

  // Still on the strait: a refused step costs the bear nothing.
  const bear = bearOf(after, id);
  assertDeepEqual(bearTile(bear), { col: BEAR_COL, row: ROW }, "its tile");
  assertDeepEqual(
    bearStepTile(bear),
    { col: BEAR_COL, row: ROW },
    "the tile it is travelling into, a refused step leaving it settled",
  );
  assertLessThanOrEqual(
    Math.max(
      Math.abs(bear.x - tileCX(BEAR_COL)),
      Math.abs(bear.y - tileCY(ROW)),
    ),
    CENTRE_TOLERANCE,
    "stage units between its centre and the centre of the tile it stood on",
  );
});
