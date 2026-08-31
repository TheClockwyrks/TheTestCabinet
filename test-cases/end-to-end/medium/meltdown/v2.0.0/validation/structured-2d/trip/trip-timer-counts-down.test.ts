// Meltdown — trip/trip-timer-counts-down: the cooldown is five seconds.
//
// specs/heat.md, The trip: a tripped emitter "carries a cooldown of `TRIP_TIME`
// (`5.0`) seconds, counting down against the game time each frame advances by."
// Two halves, and this item decides both: the cooldown a trip STARTS is
// `TRIP_TIME`, and what runs it down is game time.
//
// WHY THIS ONE REACHES THE TRIP ON THE REAL PATH. The cooldown's opening value is
// something the TRIP does, so a scenario that posed the timer with
// `setTowerTripTimer` and then read it back would be asserting its own argument —
// and that read-back is already `instrumentation.poses-read-back`'s requirement,
// not this one's. So the tower here crosses `100` under its own shots, exactly as
// in `trips-at-100`, and the timer is read on the frame of the crossing. (The
// group's other items, which are about what an ALREADY-tripped tower does, pose
// the state directly and depend on no part of targeting or the fire clock.)
//
// THE COUNTDOWN IS MEASURED AGAINST THE GAME'S OWN CLOCK, not against a frame
// count and not against the wall. `windowOfFrames` brackets a stretch of the
// build's own frames with one snapshot at each end — under this engine
// `engine.advance` IS the player's frame loop running against a different clock
// object — and `simTime` is what the simulation says it advanced by across them
// (specs/instrumentation.md), so what this asserts is the specification's own
// words: the timer falls by the game time the frames advanced by. A build that
// counts frames, or seconds of real time, or half-seconds, disagrees by whole
// tenths over a window this long.
//
// THE STUTTER AND THE OPENING HEAT are `trips-at-100`'s, for the reason given
// there: specs/towers.md's figures put a lone Stutter posed at `98` across the
// line on its first shot, a seventh of a second in.

import { afterEach, beforeEach, it } from "vitest";
import { TRIP_TIME } from "../../src/constants";
import { assertCloseTo, assertTrue } from "../assert";
import {
  captureStill,
  clockGain,
  createHarness,
  poseTower,
  seconds,
  startRun,
  ticksFor,
  windowOfFrames,
  type Harness,
} from "../harness";
import { FREE_SITE, poseMarkEast, towerOf } from "./bench";

/** The emitter driven over the line, and the heat it opens just under it at. */
const TOWER = "stutter";
const OPENING_HEAT = 98;

/** How long the sweep to the crossing may run, in seconds of game time. */
const SWEEP_SECONDS = 2.0;

/** The windows the countdown is read over, and how long each one is. */
const WINDOWS = 4;
const WINDOW_SECONDS = 1.0;

/**
 * How close the cooldown's opening value must come to `TRIP_TIME`, as decimal
 * places of a second.
 *
 * One place is `0.05` s, six frames of the 120 Hz clock. specs/heat.md starts the
 * cooldown at `5.0` on the frame of the crossing and runs it down against that
 * frame's own game time or the next one's — a frame either way is `0.0083` s, so
 * six frames of room costs the reading nothing. What it excludes is every other
 * cooldown a build might carry: `4.0`, `6.0`, or a timer that opens at `0`.
 */
const START_DIGITS = 1;

/**
 * How close each second of countdown must track the game time it spans, as
 * decimal places of a second.
 *
 * Two places is `0.005` s, under one frame. Both quantities compared are sums of
 * the same per-frame deltas, so a build that obeys the specification differs from
 * the game clock only by the float slack of a hundred and twenty additions, many
 * orders below the bound. What the bound excludes is every wrong clock: a
 * countdown at half rate is out by `0.5` s per window, one that runs on real time
 * rather than game time drifts with the host, and one that does not run at all is
 * out by the whole second.
 *
 * The RUNNING TOTAL after each window is read to {@link START_DIGITS} instead,
 * because it carries the same one-frame ambiguity the opening value does: a build
 * that runs the crossing frame's own game time off the fresh cooldown sits one
 * frame lower than one that starts it the frame after.
 */
const RATE_DIGITS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("The cooldown is five seconds", async () => {
  startRun(h);
  const id = poseTower(h, TOWER, FREE_SITE.col, FREE_SITE.row);
  h.debug.setTowerHeat(id, OPENING_HEAT);
  poseMarkEast(h, TOWER, FREE_SITE);

  const swept = await h.until((s) => towerOf(s, id).tripped, {
    maxFrames: ticksFor(SWEEP_SECONDS),
  });
  assertTrue(
    swept.hit,
    `a ${TOWER} firing from heat ${OPENING_HEAT} to trip within ` +
      `${SWEEP_SECONDS}s of game time`,
  );

  assertCloseTo(
    towerOf(h.snapshot(), id).tripTimer,
    TRIP_TIME,
    START_DIGITS,
    "the cooldown a trip opens with, on the frame of the crossing",
  );

  for (let n = 1; n <= WINDOWS; n += 1) {
    const span = await windowOfFrames(h, ticksFor(WINDOW_SECONDS));
    const spanned = clockGain(span);
    const fell =
      towerOf(span.opened, id).tripTimer - towerOf(span.closed, id).tripTimer;
    assertCloseTo(
      fell,
      spanned,
      RATE_DIGITS,
      `seconds the cooldown fell over the ${n}th window, against the ` +
        `${spanned.toFixed(3)}s of game time it spanned`,
    );
    assertCloseTo(
      towerOf(span.closed, id).tripTimer,
      TRIP_TIME - seconds(n * ticksFor(WINDOW_SECONDS)),
      START_DIGITS,
      `the cooldown left ${n}s after the trip`,
    );
  }
  captureStill(h, "cooldown");
});
