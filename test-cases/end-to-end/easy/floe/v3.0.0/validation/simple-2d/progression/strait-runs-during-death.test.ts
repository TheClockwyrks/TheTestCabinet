// progression/strait-runs-during-death — the lanes keep running at their speeds
// while a death is being held.
//
// specs/progression.md, of all three holds: "The strait keeps running through every
// hold: the lanes advance, the bonus catch keeps its cadence, and any bear still on
// the strait travels." specs/ice.md and specs/water.md fix what advancing means: "A
// lane at speed `s` and direction `d` moves every one of its items by `d * s * TILE`
// units per second of game time."
//
// ONE ITEM FROM EACH BAND, because the two bands are two rosters
// (specs/instrumentation.md) and a build that kept one running through the hold and
// froze the other must fail. Each is read by the id `poseLane` handed back, so
// neither reading can be confused with the other's.
//
// BOTH LANES ARE GIVEN SPEEDS OF THIS CHECK'S OWN CHOOSING, and in opposite
// directions. What each lane's own figure is worth is `ice/lane-speeds` and
// `water/lane-speeds`; what this point needs is two lanes whose displacement over a
// known stretch of hold is a number this file states. The opposite directions mean a
// build that carried both bands the same way reads one of the two wrong.
//
// THE DEATH IS TAKEN ON NEITHER OF THOSE TWO ROWS. The critter is stood on an
// emptied water row of its own and falls in on the next tick (specs/water.md), so
// nothing that killed it is on either lane being measured, and the measurement begins
// from the tick AFTER the life was lost — the whole span read is inside the hold.
//
// THE TOLERANCE IS TWO TICKS OF THE FASTER LANE. A build is free to advance its lanes
// before or after it tests the hazards within a tick, which can put a reading one
// tick either side of the span this check drove; two ticks of the faster of the two
// lanes covers both, and it is a fortieth of the displacement being measured, so a
// band that was frozen or run at another speed cannot hide inside it.

import { afterEach, beforeEach, it } from "vitest";
import { START_COL, TICK_DT, TILE } from "../constants";
import { assertBetween, assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  floeOf,
  poseLane,
  seconds,
  startCrossing,
  ticksFor,
  vehicleOf,
  type Harness,
} from "../harness";

/** The water tile the death is taken on: its own row, carrying nothing. */
const DEATH_COL = START_COL;
const DEATH_ROW = 4;

/** The ice lane that is measured: its row, its item's column, its speed, its direction. */
const ICE_ROW = 15;
const ICE_COL = 10;
const ICE_SPEED = 2;
const ICE_DIR = 1;

/** The water lane that is measured, running the other way. */
const WATER_ROW = 8;
const WATER_COL = 20;
const WATER_SPEED = 3;
const WATER_DIR = -1;

/** The one tick the fall needs. */
const FALL_TICKS = 1;

/**
 * The stretch of the hold the displacement is measured over.
 *
 * Six tenths of a second, comfortably inside the `DEATH_PAUSE` (`0.9` s) the fall
 * begins, so both readings are taken while the crossing is still held.
 */
const SPAN = ticksFor(0.6);

/** What each lane must have carried its item over that span, in stage units. */
const ICE_TRAVEL = ICE_DIR * ICE_SPEED * TILE * seconds(SPAN);
const WATER_TRAVEL = WATER_DIR * WATER_SPEED * TILE * seconds(SPAN);

/** Two ticks of the faster of the two lanes, in stage units. */
const TOLERANCE = 2 * Math.max(ICE_SPEED, WATER_SPEED) * TILE * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps both bands advancing at their speeds through the death hold", async () => {
  startCrossing(h);
  const [vehicle] = poseLane(h, ICE_ROW, "car", [ICE_COL]);
  const [floe] = poseLane(h, WATER_ROW, "pan", [WATER_COL]);
  h.debug.setLaneDirection(ICE_ROW, ICE_DIR);
  h.debug.setLaneSpeed(ICE_ROW, ICE_SPEED);
  h.debug.setLaneDirection(WATER_ROW, WATER_DIR);
  h.debug.setLaneSpeed(WATER_ROW, WATER_SPEED);
  h.debug.setCritterTile(DEATH_COL, DEATH_ROW);

  const { opened, closed } = await captureReplay(h, "pause", async () => {
    await h.advance(FALL_TICKS);
    const start = h.snapshot();
    await h.advance(SPAN);
    return { opened: start, closed: h.snapshot() };
  });

  // The situation the two readings were taken in: the whole span lies inside a hold
  // a lost life began.
  assertEqual(opened.phase, "dying", "a life lost on the emptied water band");
  assertEqual(
    closed.phase,
    "dying",
    "the whole span read from inside the hold",
  );

  const iceFrom = vehicleOf(opened, vehicle).x;
  const iceTo = vehicleOf(closed, vehicle).x;
  assertBetween(
    iceTo - iceFrom,
    ICE_TRAVEL - TOLERANCE,
    ICE_TRAVEL + TOLERANCE,
    `an ice lane at ${ICE_SPEED} tiles a second, over ${seconds(SPAN)} s of hold`,
  );

  const waterFrom = floeOf(opened, floe).x;
  const waterTo = floeOf(closed, floe).x;
  assertBetween(
    waterTo - waterFrom,
    WATER_TRAVEL - TOLERANCE,
    WATER_TRAVEL + TOLERANCE,
    `a water lane at ${WATER_SPEED} tiles a second, over ${seconds(SPAN)} s of hold`,
  );
});
