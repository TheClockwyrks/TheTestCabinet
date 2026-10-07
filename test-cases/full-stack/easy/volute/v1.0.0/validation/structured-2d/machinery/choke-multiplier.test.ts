// machinery/choke-multiplier — the lead segment rides at 0.4x the feed while choke runs.
//
// WHAT THE SPEC FIXES. `specs/machinery.md` ("The four kinds"): "`choke` | The
// feed speed is multiplied by `0.4`". `specs/channel.md` ("The effective feed
// speed"): "effective feed speed = level feed speed x (1 + pressure / 100) x
// choke factor", and "The lead segment | advances at | the effective feed
// speed". `specs/progression.md` ("Levels") gives level 1 a feed speed of 22
// units/s. So at level 1 with the pressure at 0 a choked lead segment gains
// 22 x 1 x 0.4 = 8.8 units of arc per second, which is what
// `effectiveFeed(1, 0, true)` in `constants.ts` computes rather than this file
// spelling the product.
//
// WHY ONE CORE. `specs/channel.md`: "A **segment** is a maximal run of
// consecutive cores ... a lone core forms a segment of one, and the lead segment
// is the one containing the head." One core is therefore the whole train and the
// lead segment both, so nothing about catch-up, merging or recoil enters the
// reading. `poseHall` leaves the quota at 0, so the inlet emits nothing that
// could join it, and the pressure at 0, so the multiplier under test is the only
// factor away from 1.
//
// THE TOLERANCE. The measurement is a whole number of ticks from a posed arc
// position, so an ideal build lands exactly on 8.8 after 60 ticks. The case's
// standing duration tolerance is +/- 2 ticks (`TICK_TOL`), and two ticks of
// choked travel is 2 x 8.8 / 60 = 0.293 units — the +/- 0.3 the review item
// states. Wide enough for a build that starts the timer a tick either side of
// the grant, and far tighter than the 13.2 units that separate a choked segment
// from an unchoked one over the same second.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import {
  CHOKE_FACTOR,
  TICK_DT,
  TICK_HZ,
  TICK_TOL,
  effectiveFeed,
} from "../constants";
import {
  captureReplay,
  createHarness,
  head,
  poseHall,
  seconds,
  type Harness,
} from "../harness";

/** The level the reading is taken on, whose feed speed the specs fix at 22. */
const LEVEL = 1;

/** Where the lone core is posed: mid-channel, clear of the inlet and the intake. */
const CORE_S = 1000;

/** One second of simulated time, the span the gain is read over. */
const MEASURE_TICKS = TICK_HZ;

/** Further ticks recorded after the reading, so the replay shows the crawl. */
const TRAILING_TICKS = TICK_HZ;

/** The choked rate the specs give: 22 x (1 + 0 / 100) x 0.4. */
const CHOKED_FEED = effectiveFeed(LEVEL, 0, true);

/** The arc a choked lead segment covers in {@link MEASURE_TICKS}. */
const EXPECTED_GAIN = CHOKED_FEED * seconds(MEASURE_TICKS);

/** Two ticks of choked travel: the case's duration tolerance, in arc units. */
const GAIN_TOL = TICK_TOL * CHOKED_FEED * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it(`gains ${EXPECTED_GAIN} units of arc a second while choke is active`, async () => {
  await poseHall(h, {
    level: LEVEL,
    pressure: 0,
    cores: [[CORE_S, "halide", null]],
    machinery: "choke",
  });
  const before = h.snapshot();

  const after = await captureReplay(h, "choke", async () => {
    const measured = await h.step(MEASURE_TICKS);
    await h.step(TRAILING_TICKS);
    return measured;
  });

  assertNear(
    head(after).s - head(before).s,
    EXPECTED_GAIN,
    GAIN_TOL,
    `arc gained over ${MEASURE_TICKS} ticks at the level ${LEVEL} feed times ${CHOKE_FACTOR}`,
  );
});
