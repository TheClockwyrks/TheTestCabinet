// Meltdown — trip/rime-trips-at-100: the Rime trips like any emitter.
//
// `specs/towers.md` puts the Rime's redline at `100`: "its redline sits at the
// trip, so it never reaches a plateau". That makes it the one emitter for which
// the redline and the trip are the same number, and the wrong model this item
// exists to name is a build that treats the redline as the thing that matters —
// exempting the Rime from the trip because it never leaves its curve, or
// tripping it at its redline and calling that something else. `specs/heat.md`
// grants no exception: an emitter trips on the frame in which its newly written
// heat reaches `100` having opened that frame below it, and the Rime is an
// emitter.
//
// THE RIME IS DRIVEN AT LEVEL III, and that is arithmetic rather than taste. A
// level-I Rime cannot reach the trip by firing at all: `specs/towers.md` gives
// it `heatPerShot` `7.0` over mass `1.1`, so one shot adds `6.36`, while its
// three radiator faces and one plain face shed up to
// `(3.6 * 6 + 1.1 * 2) / 1.1` per second, which over its `1 / 2.4` second
// interval is `9.02` — more than the shot puts in, so a lone level-I Rime
// settles below the trip and stays there forever. `specs/towers.md` multiplies
// `heatPerShot` by `1.3` and the fire rate by `1.15` per level, so at level III
// the shot adds `11.83 / 1.1`, which is `10.75`, against at most `6.82` of air
// in the shorter `1 / 3.174` second interval. Opening at `99` therefore leaves
// the first shot writing at least `102.9`. Level changes neither the redline nor
// the mass (`specs/towers.md`), so the tower under test is the same tower.
//
// This is the Rime's own crossing and nothing else: `trip/trips-at-100` decides
// that the crossing happens at all, on a different gun.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { TRIP_HEAT, TRIP_TIME } from "../constants";
import {
  captureStill,
  createHarness,
  requireTower,
  seconds,
  type Harness,
} from "../harness";
import {
  TRIP_SWEEP_INTERVALS,
  maxAirLossPerIntervalOf,
  poseLiveGun,
  shotHeatOf,
  sweepToTheTrip,
} from "./bench";

/** The emitter whose redline IS the trip, at the level its shot outruns its air. */
const TOWER = "rime";
const LEVEL = 3;

/** The heat the gun opens at: one point below the trip, so the frame crosses it. */
const OPENING_HEAT = TRIP_HEAT - 1;

/** `heatPerShot / mass` at level III: 7.0 * 1.3^2 over 1.1, so 10.75. */
const SHOT_HEAT = shotHeatOf(TOWER, LEVEL);

/** The most air takes between two of its shots, at the trip itself: 6.82. */
const AIR_PER_INTERVAL = maxAirLossPerIntervalOf(TOWER, LEVEL);

/**
 * How far below `100` the heat may read on the frame the trip is caught.
 *
 * `specs/heat.md` writes the trip on the frame the heat REACHES `100` and clamps
 * heat to `[0, 100]`, so the crossing frame reads exactly `100`. A build that
 * starts the `TRIP_HEAT / TRIP_TIME` bleed on that same frame instead of the next
 * reads one frame of it lower, and that one frame is the whole of the room here.
 * It is what makes this item about the LINE rather than about the flag: a build
 * that trips at its redline, or at `99`, reads whole heat points away and is
 * caught, where a check that read `tripped` alone would take it.
 */
const HEAT_FLOOR = TRIP_HEAT - (TRIP_HEAT / TRIP_TIME) * seconds(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("The Rime trips like any emitter", async () => {
  const { id } = await poseLiveGun(h, TOWER, OPENING_HEAT, LEVEL);

  assertEqual(
    requireTower(await h.snapshot(), id, "the emitter as it was posed").tripped,
    false,
    `whether a ${TOWER} posed at heat ${OPENING_HEAT} is already tripped, ` +
      `which specs/heat.md puts at the ${TRIP_HEAT} it has not yet reached`,
  );

  const swept = await sweepToTheTrip(h, id, TOWER, LEVEL);
  await captureStill(h, "trip");
  const gun = requireTower(swept.snapshot, id, "the Rime driven to the trip");

  assertEqual(
    gun.tripped,
    true,
    `a level-${LEVEL} ${TOWER} opening at ${OPENING_HEAT} to trip within ` +
      `${TRIP_SWEEP_INTERVALS} fire intervals although its redline is the ` +
      `trip, its ${SHOT_HEAT.toFixed(2)} per shot against at most ` +
      `${AIR_PER_INTERVAL.toFixed(2)} of air between two: after ` +
      `${swept.frames} frames it sat at heat ${gun.heat.toFixed(3)}`,
  );

  assertGreaterThanOrEqual(
    gun.heat,
    HEAT_FLOOR,
    `the heat the ${TOWER} tripped at, which specs/heat.md puts at ` +
      `${TRIP_HEAT} for every emitter`,
  );
});
