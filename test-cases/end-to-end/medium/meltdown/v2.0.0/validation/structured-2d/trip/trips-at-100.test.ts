// Meltdown — trip/trips-at-100: reaching 100 trips the tower.
//
// specs/heat.md, The trip: "An emitter trips on the frame in which its newly
// written heat reaches `100` having opened that frame below `100`." This is the
// one item in the group that reaches the trip ON THE REAL PATH — an emitter with
// its thermal model running and its guns live, carried over the line by its own
// shots — because the trip EVENT is what it decides, and an event has to be
// produced by the heat model rather than posed. Every other item here poses an
// already-tripped tower, so none of them depends on targeting, range or the fire
// clock.
//
// WHY THE STUTTER, AND WHY 98. specs/towers.md gives the Stutter a 2x2 footprint
// with radiator faces N and E, `heatPerShot` `4.2`, mass `0.5` and `7.0` shots a
// second. Standing alone its eight perimeter edge-tiles are four radiator and
// four plain, so specs/heat.md sheds `(3.6 * 4 + 1.1 * 4) * (H / 100)` a second,
// which mass turns into `37.6 * (H / 100)` a second of heat; one shot adds
// `4.2 / 0.5`, which is `8.4`. Over the `1 / 7` s that separates two shots a
// tower near `98` therefore loses about `5.3` and gains `8.4`, so it climbs, and
// the FIRST shot carries `98` across `100`. Every emitter on the roster climbs
// like this; the Stutter is the one that does it in a seventh of a second.
//
// THE SWEEP IS BOUNDED BY THE SPECIFICATION, NOT BY THE REFERENCE. The
// arithmetic above puts the crossing one fire interval in; the bound below is
// fourteen of them, which is far past any conforming build's accumulation of
// floating-point deltas and still far short of a build that never trips at all.
//
// THE HEAT IS READ AT THE CROSSING TOO, so a build that trips EARLY — on the
// redline, say, or on any heat it calls hot — fails here rather than passing an
// item about the trip while being wrong about where it is.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual, assertTrue } from "../assert";
import { TRIP_HEAT, TRIP_TIME } from "../constants";
import {
  captureStill,
  createHarness,
  poseTower,
  seconds,
  startRun,
  ticksFor,
  type Harness,
} from "../harness";
import { FREE_SITE, poseMarkEast, towerOf } from "./bench";

/** The emitter driven over the line, and the heat it opens just under it at. */
const TOWER = "stutter";
const OPENING_HEAT = 98;

/**
 * How long the sweep may run, in seconds of game time.
 *
 * specs/towers.md and specs/heat.md put the crossing one `1 / 7` s fire interval
 * in (see the head), so two seconds is fourteen intervals. It is a ceiling on the
 * sweep rather than a tolerance on a figure: nothing about the verdict changes
 * anywhere inside it, and a build that has not tripped a lone Stutter posed at
 * `98` after two seconds of firing is not going to.
 */
const SWEEP_SECONDS = 2.0;

/**
 * How far below `100` the heat may read on the frame the trip is caught.
 *
 * specs/heat.md writes the trip on the frame the heat REACHES `100` and clamps
 * heat to `[0, 100]`, so the crossing frame reads exactly `100`; a build that
 * starts the `TRIP_HEAT / TRIP_TIME` bleed on that same frame instead of the next
 * reads one frame of it lower, which is `20 / 120`. That one frame is the whole
 * of the room here — a build that trips at its redline `60`, or at `99`, reads
 * whole heat points away.
 */
const HEAT_FLOOR = TRIP_HEAT - (TRIP_HEAT / TRIP_TIME) * seconds(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("Reaching 100 trips the tower", async () => {
  startRun(h);
  const id = poseTower(h, TOWER, FREE_SITE.col, FREE_SITE.row);
  h.debug.setTowerHeat(id, OPENING_HEAT);
  poseMarkEast(h, TOWER, FREE_SITE);

  assertEqual(
    towerOf(h.snapshot(), id).tripped,
    false,
    `whether a ${TOWER} posed at heat ${OPENING_HEAT} is already tripped`,
  );

  const swept = await h.until((s) => towerOf(s, id).tripped, {
    maxFrames: ticksFor(SWEEP_SECONDS),
  });
  captureStill(h, "trip");

  assertTrue(
    swept.hit,
    `a ${TOWER} firing from heat ${OPENING_HEAT} to trip within ` +
      `${SWEEP_SECONDS}s of game time`,
  );

  const tower = towerOf(h.snapshot(), id);
  assertEqual(tower.tripped, true, "whether the tower reports tripped");
  assertGreaterThanOrEqual(
    tower.heat,
    HEAT_FLOOR,
    `the heat the ${TOWER} tripped at, which specs/heat.md puts at ` +
      `${TRIP_HEAT}`,
  );
});
