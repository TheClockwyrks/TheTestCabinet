// Floe — audio/cue-crush: the tick a moving vehicle first covers the critter's
// centre plays the crush cue, and the approach before it plays none.
//
// The cue is read BY NAME off the engine's bus; see audio/cue-hop for the reading
// every check in this directory rests on.
//
// THE RULE THIS POINT DECIDES. `specs/ui.md`: the `crush` cue plays when "a
// vehicle crushes the critter". `specs/ice.md` fixes when that is — "the critter
// is crushed on any tick on which a vehicle in a lane whose speed is above `0`
// covers the critter's centre" — and covering is that same file's span rule, a
// point `x` lying in `[itemX, itemX + TILE * len)`.
//
// THE ARRIVAL IS COMPUTED, NOT SEARCHED FOR. The lane's speed is POSED by this
// check through `setLaneSpeed` rather than taken from the level, so the moment
// the car's span first reaches the critter's centre follows from two figures the
// check itself fixed and the covering rule `specs/ice.md` states. The approach is
// then driven to a quarter second SHORT of that moment and must be silent, and
// the next half second carries the car a quarter second PAST it and must sound.
// Neither window sweeps for the event, so nothing here secretly demands a speed
// the specification never fixed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  CUES,
  ITEM_LEN,
  START_COL,
  START_LIVES,
  TILE,
  tileCX,
  tileLeft,
} from "../constants";
import {
  captureReplay,
  createHarness,
  poseLane,
  startCrossing,
  ticksFor,
  watchCues,
  type Harness,
  type TimedCue,
  type VehicleKind,
} from "../harness";

/**
 * The ice-band row the crush is posed on.
 *
 * Any of rows `11`–`18` decides the same rule (`specs/strait.md`); the middle of
 * the band is taken so neither solid strip is next to it.
 */
const CRUSH_ROW = 15;

/** The vehicle: a `car`, `2` tiles long by `specs/ice.md`. */
const CRUSH_KIND: VehicleKind = "car";

/** The tile the car's left edge is posed at, three tiles left of the critter. */
const VEHICLE_COL = START_COL - 3;

/**
 * The lane's posed speed, in tiles per second.
 *
 * Fixed HERE, through `setLaneSpeed` (`specs/instrumentation.md`), rather than
 * taken from the level, so the arrival below is arithmetic over figures this
 * check set rather than a demand on a speed the specification fixes elsewhere.
 */
const LANE_SPEED = 2;

/** The critter's centre, which `specs/ice.md` reads the covering against. */
const CRITTER_X = tileCX(START_COL);

/**
 * When the car's span first reaches that centre, in seconds of game time.
 *
 * `specs/ice.md`: the car covers a point `x` when `x` lies in
 * `[vx, vx + TILE * len)`, so it first covers `CRITTER_X` as its left edge
 * passes `CRITTER_X - TILE * len`. It starts at `tileLeft(VEHICLE_COL)` and moves
 * `LANE_SPEED * TILE` units a second, which works the arrival out at `0.75` s.
 */
const ARRIVAL_SECONDS =
  (CRITTER_X - TILE * ITEM_LEN[CRUSH_KIND] - tileLeft(VEHICLE_COL)) /
  (LANE_SPEED * TILE);

/**
 * How far either window is held off the arrival, in seconds.
 *
 * A quarter second is thirty ticks at `TICK_HZ` (`120`), so neither window's
 * verdict can turn on where a tick boundary fell, and it is a third of the
 * `0.75` s `ARRIVAL_SECONDS` works out to under the figures posed above.
 */
const MARGIN_SECONDS = 0.25;

/** The approach: driven to a margin SHORT of the arrival, and silent. */
const APPROACH_TICKS = ticksFor(ARRIVAL_SECONDS - MARGIN_SECONDS);

/** The arrival: carries the car from a margin short to a margin past it. */
const ARRIVAL_TICKS = ticksFor(2 * MARGIN_SECONDS);

/** How many times `cue` sounded in `played`, from index `from` on. */
function sounded(
  played: readonly TimedCue[],
  from: number,
  cue: string,
): number {
  return played.slice(from).filter((entry) => entry.cue === cue).length;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays the crush cue as the vehicle arrives on the critter, and not on the approach", async () => {
  // An empty strait with one car in one lane, and the critter standing in that
  // lane's path. Nothing else on the strait can take the life instead.
  startCrossing(h);
  h.debug.addCritter(START_COL, CRUSH_ROW);
  poseLane(h, CRUSH_ROW, CRUSH_KIND, [VEHICLE_COL]);
  h.debug.setLaneDirection(CRUSH_ROW, 1);
  h.debug.setLaneSpeed(CRUSH_ROW, LANE_SPEED);

  const played = watchCues(h);
  const measured = await captureReplay(h, "crush", async () => {
    const beforeApproach = played.length;
    await h.advance(APPROACH_TICKS);
    const approach = sounded(played, beforeApproach, CUES.crush);
    const short = h.snapshot();

    const beforeArrival = played.length;
    await h.advance(ARRIVAL_TICKS);
    const arrival = played
      .slice(beforeArrival)
      .filter((entry) => entry.cue === CUES.crush);
    const crushed = h.snapshot();

    return { approach, short, arrival, crushed };
  });

  // The car really had not reached the critter yet.
  assertEqual(measured.short.lives, START_LIVES, "the approach cost no life");
  assertEqual(
    measured.short.phase,
    "crossing",
    "the crossing is still running on the approach",
  );
  assertEqual(
    measured.approach,
    0,
    "no crush cue while the car is short of the critter",
  );

  // And then it really did arrive on it (specs/ice.md, specs/progression.md).
  assertEqual(measured.crushed.lives, START_LIVES - 1, "the crush cost a life");
  assertEqual(
    measured.crushed.phase,
    "dying",
    "the crush opened the death hold",
  );
  assertLength(
    measured.arrival,
    1,
    "crush cues played as the vehicle arrived on the critter",
  );
});
