// Meltdown — trip/trip-timer-counts-down: the cooldown is five seconds.
//
// `specs/heat.md` gives a tripped emitter "a cooldown of `TRIP_TIME` (`5.0`)
// seconds, counting down against the game time each frame advances by". Two
// readings, one drive: what the cooldown OPENS at, and that it falls at the rate
// of the clock rather than at some rate of its own.
//
// THE COOLDOWN IS READ OFF A REAL TRIP, NOT A POSED ONE. `setTowerTripTimer`
// sets that field alone (`specs/instrumentation.md`), so a check that posed
// `5.0` and read `5.0` back would be grading its own arrangement rather than the
// build. The figure a build hands a tower AT THE MOMENT IT TRIPS is only visible
// on the frame the crossing was written on, so this is the one item about an
// already-tripped tower that reaches the trip through the heat model: a Stutter
// opening at `99`, whose `8.4` per shot outruns the `5.37` air takes between two
// (`trip/trips-at-100` states that arithmetic in full), swept a frame at a time
// so the reading lands on the trip frame itself.
//
// THE FALL IS MEASURED AS A DIFFERENCE over a whole second of game time, taken
// between two frame boundaries. Reading the difference rather than the second
// value is what makes the second assertion independent of the first: a build
// that opens its cooldown at `4.99167` because it also decremented on the trip
// frame still has to lose exactly one second in one second.
//
// NEITHER READING IS ABOUT WHAT THE COOLDOWN ENDS IN. That the tower comes back
// online, cold, when it reaches `0` is `trip/returns-cold`'s single requirement,
// and the window here stops four seconds short of it.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { TRIP_HEAT, TRIP_TIME } from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  requireTower,
  type Harness,
} from "../harness";
import { poseLiveGun, readTower, sweepToTheTrip } from "./bench";

/** The emitter driven over the trip, and the heat it opens at. */
const TOWER = "stutter";
const LEVEL = 1;
const OPENING_HEAT = TRIP_HEAT - 1;

/**
 * The stretch of game time the fall is measured over, in seconds.
 *
 * One second is long enough that no plausible wrong rate survives it — a
 * cooldown counting frames rather than seconds, or running at the game speed
 * twice over — and four seconds short of the `5.0` at which the cooldown ends,
 * so nothing here reads the return.
 */
const WINDOW = 1;

/**
 * How close the OPENING cooldown must come to `5.0`, as decimal places.
 *
 * One place is `0.05` of a second, six frames of the default clock. The room is
 * there for one thing only: a build is free to write the cooldown and then
 * decrement it on the very frame that wrote it, which costs a single frame of
 * game time (`0.00833`), and both readings are conformant. What `0.05` excludes
 * is every other cooldown a build might have chosen — `4.0`, `5.5`, `10.0` — by
 * two orders of magnitude.
 */
const OPENING_DIGITS = 1;

/**
 * How close the FALL must come to the second of game time it was measured over,
 * as decimal places.
 *
 * Two places is `0.005` of a second. Both readings are taken at frame
 * boundaries, an exact `1.0` second of game time apart, so a build that
 * subtracts each frame's own `dt` lands on `1.0` to float slack whatever it
 * opened at. What the bound excludes is a cooldown counting real time rather
 * than game time, one counting frames, and one running at half or twice the
 * clock — every one of them tenths of a second away.
 */
const FALL_DIGITS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("The cooldown is five seconds", async () => {
  const { id } = await poseLiveGun(h, TOWER, OPENING_HEAT, LEVEL);

  const swept = await sweepToTheTrip(h, id, TOWER, LEVEL);
  const opened = requireTower(
    swept.snapshot,
    id,
    "the emitter on the frame it tripped",
  );
  await h.advance(framesFor(WINDOW));
  await captureStill(h, "cooldown");
  const later = await readTower(h, id, `the tripped emitter ${WINDOW}s on`);

  assertCloseTo(
    opened.tripTimer,
    TRIP_TIME,
    OPENING_DIGITS,
    `the cooldown a ${TOWER} carries on the frame it trips, with ` +
      `tripped ${String(opened.tripped)} at heat ${opened.heat.toFixed(3)}`,
  );
  assertCloseTo(
    opened.tripTimer - later.tripTimer,
    WINDOW,
    FALL_DIGITS,
    `the seconds the cooldown loses over ${WINDOW}s of game time, from ` +
      `${opened.tripTimer.toFixed(4)} to ${later.tripTimer.toFixed(4)}`,
  );
});
