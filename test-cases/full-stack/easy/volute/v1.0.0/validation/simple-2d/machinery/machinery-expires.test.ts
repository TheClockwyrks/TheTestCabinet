// machinery/machinery-expires — choke lapses at its stated duration and the feed returns.
//
// WHAT THE SPEC FIXES. `specs/machinery.md` ("The four kinds") gives choke a
// duration of 8 s, and ("The active machinery") "Its remaining time falls with
// simulation time while play advances, and the machinery ends the moment that
// time reaches `0`." `specs/instrumentation.md` ("Snapshot shape") reports
// `machinery` as "`null` while no timed machinery is active". So after 8 s of
// stepped play the grant is over, and `specs/channel.md`'s effective feed speed
// takes its choke factor of `1` again: the level 1 lead segment is back at
// 22 units/s with the pressure at 0.
//
// WHY 481 TICKS. `specs/instrumentation.md` fixes the tick at 1 / 60 s, so 8 s
// is 480 ticks exactly. Stepping 481 puts the reading a tick past the boundary
// rather than on it, so a build that ends the run at the tick the timer reaches
// zero and a build that ends it on the tick after both read as expired, and
// neither is graded on which side of an exact equality it fell.
//
// WHY ONE CORE. As in `choke-multiplier`: "a lone core forms a segment of one,
// and the lead segment is the one containing the head" (`specs/channel.md`), so
// the reading is the feed speed and nothing else. `poseHall` holds the inlet, so
// it adds nothing, and the pressure is 0, so the only factor away from 1 is the
// one that has just lapsed.
//
// WHAT THE REPLAY BRACKETS. The behavior the point backs is the LAPSE and the
// feed returning with it, which is the last second of the drive. The eight
// seconds of choke before it are a hall running down and would fill a recording
// (three hundred frames at most, so a longer one is thinned to fit) with the part
// that does not matter. So the wait is stepped OUTSIDE the recorder and only a
// short run-up before the expiry tick is armed, which leaves the reviewer a
// hundred-odd undecimated frames around the moment the choke ends.
//
// THE TOLERANCE. An ideal build gains exactly 22 units over the 60 ticks after
// the lapse. The case's standing speed tolerance is 2% of the stated figure
// (`SPEED_TOL_FRACTION`), which is 0.44 units here — and 0.44 is also exactly
// two ticks of the 13.2 units/s that separate the choked rate from the free one,
// so the same number is both the standing bound and two ticks of slack in when
// the build ended the grant. A build that never ends the choke gains 8.8 and
// misses by thirty times the bound.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear, assertNull } from "../assert";
import {
  CHOKE_DURATION,
  SPEED_TOL_FRACTION,
  TICK_HZ,
  effectiveFeed,
  speedTolerance,
} from "../constants";
import {
  captureReplay,
  createHarness,
  head,
  poseHall,
  seconds,
  ticksFor,
  type Harness,
  type VoluteSnapshot,
} from "../harness";

/** The level the reading is taken on, whose feed speed the specs fix at 22. */
const LEVEL = 1;

/** Where the lone core is posed: clear of the inlet, and clear of the intake. */
const CORE_S = 500;

/** A tick past the 8 s the specs give choke, so the boundary itself is not graded. */
const EXPIRE_TICKS = ticksFor(CHOKE_DURATION) + 1;

/** One second of simulated time, the span the gain is read over. */
const MEASURE_TICKS = TICK_HZ;

/**
 * Ticks of the still-choked hall kept in front of the lapse, for the replay.
 *
 * Half a second, so a reviewer sees the slow feed arrive at the boundary rather
 * than opening on it. With the measured second after it the whole recording is
 * 90 frames, well inside the three hundred a written recording holds, so nothing
 * is decimated.
 */
const RUNUP_TICKS = TICK_HZ / 2;

/** The free rate the specs give: 22 x (1 + 0 / 100) x 1. */
const FREE_FEED = effectiveFeed(LEVEL, 0, false);

/** The arc a free lead segment covers in {@link MEASURE_TICKS}. */
const EXPECTED_GAIN = FREE_FEED * seconds(MEASURE_TICKS);

/** The case's standing speed tolerance, in arc units over the measured second. */
const GAIN_TOL = speedTolerance(FREE_FEED) * seconds(MEASURE_TICKS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it(`is back at ${FREE_FEED} units/s once the ${CHOKE_DURATION} s choke has run out`, async () => {
  await poseHall(h, {
    level: LEVEL,
    pressure: 0,
    cores: [[CORE_S, "halide", null]],
    machinery: "choke",
  });

  // The eight-second wait runs OUTSIDE the recorder: it is the choke simply
  // running down, and the behavior this point backs is what happens at the end
  // of it.
  await h.step(EXPIRE_TICKS - RUNUP_TICKS);

  let lapsed: VoluteSnapshot | undefined;
  const after = await captureReplay(h, "expiry", async () => {
    lapsed = await h.step(RUNUP_TICKS);
    return h.step(MEASURE_TICKS);
  });

  assertNull(
    lapsed?.machinery ?? null,
    `the active machinery ${seconds(EXPIRE_TICKS)} s after a ${CHOKE_DURATION} s choke was granted`,
  );
  assertNear(
    head(after).s - head(lapsed as VoluteSnapshot).s,
    EXPECTED_GAIN,
    GAIN_TOL,
    `arc gained over the ${MEASURE_TICKS} ticks after the choke lapsed ` +
      `(within ${SPEED_TOL_FRACTION * 100}% of the level ${LEVEL} feed)`,
  );
});
