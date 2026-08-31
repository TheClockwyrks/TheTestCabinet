// Meltdown — trip/tripped-takes-no-flow: a tripped tower takes part in no flow.
//
// specs/heat.md, The trip: a tripped emitter "takes part in no term of the
// frame's resolution, so nothing it touches heats it, cools it, or conducts with
// it" and bleeds at `TRIP_HEAT / TRIP_TIME` "whatever its faces and whatever
// stands beside it". `tripped-cools-linearly` reads that rate on lone towers with
// very different FACES; this item reads it on a tower with the three flows the
// game has pressing on it at once.
//
// WHY THESE THREE NEIGHBOURS. specs/heat.md's four flows are air, conduction, the
// Forge's thermostat and the Sink's drain, and the arrangement puts one of each
// on a face of the tripped tower: a hot emitter on the N face, a level-III Forge
// on the E, a Sink on the S, and the W face left open to air. Every one of them
// is a term that would move the tower's heat if the trip did not hold it out of
// the resolution, and — this is the point — they do not cancel. With the tripped
// Arc a second into its bleed at heat `80`, specs/heat.md would have conduction
// from a neighbour at `95` add `3.5 * 2 * 15`, the level-III Forge add
// `0.9 * 2 * (96 - 80)`, the Sink take `16 * 2 * 0.80` and the open W face take
// `1.1 * 2 * 0.80`, which is a NET GAIN of about `72` a second against a bleed of
// `20`. So a build that lets a tripped tower take part does not merely bleed at a
// slightly wrong rate: it climbs, and the sign of the reading names the fault.
//
// THE HOT NEIGHBOUR IS POSED AT 95 RATHER THAN 100 so no reading of the trip
// boundary enters the arrangement: at `100` a build that trips on the heat value
// rather than on the crossing would take the neighbour offline too, and the
// conduction this scenario is built on would quietly vanish. Its guns are held,
// because there is nothing on the floor to shoot at and a firing gate is a
// faculty this requirement does not exercise; its thermal model is left running,
// because that is what drives the conduction the tripped tower must ignore.
//
// THE TRIP IS POSED, NOT MANUFACTURED, for the reason the whole group poses it:
// what a tripped tower does is decided here, and how one gets tripped is
// `trips-at-100`'s single requirement.

import { afterEach, beforeEach, it } from "vitest";
import { TRIP_HEAT, TRIP_TIME } from "../../src/constants";
import { assertCloseTo } from "../assert";
import {
  captureStill,
  clockGain,
  createHarness,
  heatGain,
  poseTower,
  poseTrippedTower,
  sizeOf,
  startRun,
  ticksFor,
  windowOfFrames,
  type Harness,
} from "../harness";
import { BOXED_SITE, towerOf } from "./bench";

/** The emitter taken offline, and the heat the trip left it at. */
const TOWER = "arc";
const TRIPPED_AT = TRIP_HEAT;

/** The neighbour pressed against each face, and the heat the hot one holds. */
const HOT_NEIGHBOUR = "arc";
const HOT_HEAT = 95;
const FORGE_LEVEL = 3;

/** specs/heat.md: `TRIP_HEAT / TRIP_TIME`, which is 20 a second. */
const BLEED_RATE = TRIP_HEAT / TRIP_TIME;

/** The windows the bleed is read over, and how long each one is. */
const WINDOWS = 4;
const WINDOW_SECONDS = 1.0;

/**
 * How close each window's rate must come, as decimal places of heat per second.
 *
 * One place is `0.05` of a heat point a second, a quarter of one percent of the
 * `20` the specification states. The bleed is a per-frame subtraction of
 * `20 * dt`, so a conformant build has no need of the room; what the bound
 * excludes is a build that admits any of the three neighbours' flows, which the
 * head's arithmetic puts tens of heat points a second away and on the other side
 * of zero.
 */
const RATE_DIGITS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("A tripped tower takes part in no flow", async () => {
  startRun(h);
  const size = sizeOf(TOWER);
  const id = poseTrippedTower(
    h,
    TOWER,
    BOXED_SITE.col,
    BOXED_SITE.row,
    TRIPPED_AT,
    TRIP_TIME,
  );

  const hot = poseTower(
    h,
    HOT_NEIGHBOUR,
    BOXED_SITE.col,
    BOXED_SITE.row - sizeOf(HOT_NEIGHBOUR),
  );
  h.debug.setTowerFiring(hot, false);
  h.debug.setTowerHeat(hot, HOT_HEAT);

  const forge = poseTower(h, "forge", BOXED_SITE.col + size, BOXED_SITE.row);
  h.debug.setTowerLevel(forge, FORGE_LEVEL);

  poseTower(h, "sink", BOXED_SITE.col, BOXED_SITE.row + size);

  for (let n = 1; n <= WINDOWS; n += 1) {
    const span = await windowOfFrames(h, ticksFor(WINDOW_SECONDS));
    assertCloseTo(
      -(heatGain(span, id) ?? NaN) / clockGain(span),
      BLEED_RATE,
      RATE_DIGITS,
      `heat a tripped ${TOWER} touching a ${HOT_NEIGHBOUR} at ${HOT_HEAT}, a ` +
        `level-${FORGE_LEVEL} forge and a sink shed per second of game time ` +
        `over the ${n}th second of its ${TRIP_TIME}s cooldown`,
    );
  }
  captureStill(h, "inert");

  assertCloseTo(
    towerOf(h.snapshot(), id).heat,
    TRIP_HEAT - WINDOWS * BLEED_RATE,
    RATE_DIGITS,
    `the heat the tripped ${TOWER} is left at after ${WINDOWS}s beside its ` +
      `three neighbours`,
  );
});
