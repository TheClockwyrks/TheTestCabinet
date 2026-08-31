// Meltdown — trip/trips-at-100: reaching 100 trips the tower.
//
// `specs/heat.md` states the trip as a crossing: "An emitter trips on the frame
// in which its newly written heat reaches `100` having opened that frame below
// `100`." This is the one item whose requirement is that EVENT, so it is reached
// on the real path — an emitter with both faculties on and a mark in range,
// carried over the trip by its own next shot — rather than announced through
// `setTowerTripped`. Every other item in this group poses an already-tripped
// tower instead, so none of them rests on targeting, range or the fire clock.
//
// THE STUTTER CARRIES THE READING, AND THE ARC CANNOT. The gun has to be one
// whose shot outruns what air takes between two shots, or no opening heat below
// `100` reaches the trip on the first shot at all. `specs/towers.md` gives the
// Stutter `heatPerShot` `4.2` over mass `0.5`, so one shot adds `8.4`; its 2x2
// footprint has four radiator edge-tiles and four plain ones, so the most air
// can take from it in its `1 / 7.0` second interval is
// `(3.6 * 4 + 1.1 * 4) / 0.5 * (1 / 7.0)`, which is `5.37` — and that bound is
// taken at heat `100`, where air cooling is at its maximum, so no conformant
// build sheds faster anywhere. Opening at `99` therefore leaves the first shot
// resolving from at worst `93.6` and writing at least `102.0`, which is a
// crossing with more than two heat points to spare. The Arc's `10.3` against its
// own `9.4` would leave a tenth of a point, which is not a scenario, it is a
// coincidence.
//
// WHAT THE SWEEP IS FOR. The check does not assert WHICH shot did it: it asks
// only that a gun driven up reaches the trip, so it advances a frame at a time
// for five fire intervals and reads the flag. A build whose accumulator is
// staged differently trips a shot later and still passes; a build that never
// trips fails with the heat it was sitting at.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TRIP_HEAT } from "../constants";
import {
  captureStill,
  createHarness,
  requireTower,
  type Harness,
} from "../harness";
import {
  TRIP_SWEEP_INTERVALS,
  maxAirLossPerIntervalOf,
  poseLiveGun,
  shotHeatOf,
  sweepToTheTrip,
} from "./bench";

/** The emitter driven up, at the level `addTower` starts a tower at. */
const TOWER = "stutter";
const LEVEL = 1;

/**
 * The heat the gun opens at: one point below the trip.
 *
 * `specs/heat.md` requires the frame to OPEN below `100`, which is what makes
 * the write a crossing rather than a tower sitting at the value. One point is as
 * close as a whole number gets while still being below it.
 */
const OPENING_HEAT = TRIP_HEAT - 1;

/** `heatPerShot / mass`, which is 4.2 / 0.5, so 8.4 (`specs/heat.md`). */
const SHOT_HEAT = shotHeatOf(TOWER, LEVEL);

/** The most air takes between two shots, at the trip itself: 5.37. */
const AIR_PER_INTERVAL = maxAirLossPerIntervalOf(TOWER, LEVEL);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("Reaching 100 trips the tower", async () => {
  const { id } = await poseLiveGun(h, TOWER, OPENING_HEAT, LEVEL);

  const swept = await sweepToTheTrip(h, id, TOWER, LEVEL);
  await captureStill(h, "trip");
  const gun = requireTower(
    swept.snapshot,
    id,
    "the emitter driven to the trip",
  );

  assertEqual(
    gun.tripped,
    true,
    `a level-${LEVEL} ${TOWER} opening at ${OPENING_HEAT} to trip within ` +
      `${TRIP_SWEEP_INTERVALS} fire intervals, its ${SHOT_HEAT.toFixed(2)} ` +
      `per shot against at most ${AIR_PER_INTERVAL.toFixed(2)} of air ` +
      `between two: after ${swept.frames} frames it sat at heat ` +
      `${gun.heat.toFixed(3)}`,
  );
});
