// channel/feed-advance — the lead segment rides at the level's feed speed.
//
// THE SPEC LINE. `specs/channel.md`, "Advance": "The lead segment | the
// effective feed speed", and "Each tick a segment's rate times the tick's
// elapsed time is added to the arc position of every core in it". The effective
// feed speed is "level feed speed x (1 + pressure / 100) x choke factor"; with
// the pressure posed at 0 and no machinery granted the two factors are 1, so the
// rate is the level's own: `specs/progression.md`'s table gives level 1 a feed
// speed of 22 units/s. `constants.ts` reads both figures off those tables, so
// the bound here is the specification's and not a number this file chose.
//
// THE DRIVE. One core alone on the channel is the lead segment by definition
// ("the lead segment is the one containing the head", and "a lone core forms a
// segment of one"), so the rate it takes is the feed speed and nothing else.
// The inlet is held, so it places nothing beside it; a single core
// is far under `PRESSURE_FREE` (24), so the pressure bleeds and stays at 0
// through the drive and the multiplier stays 1. Sixty ticks is exactly one
// second of simulated time (`TICK_HZ` is 60), so the arc the core gains over
// them IS the speed in units per second.
//
// THE TOLERANCE. +/- 2% of 22 units/s, the case's standing tolerance for a speed
// measured over at least 30 ticks, and this is measured over 60. The rule is
// integrated per tick, so a conformant build lands on 22 within floating-point
// noise; the 2% covers a build that accumulates its time differently across the
// second. It is nowhere near loose enough to admit a wrong rate: the catch-up
// rate is eight times larger, and a build reading level 2's feed speed is 18%
// out.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNearFraction } from "../assert";
import { CHARGE_IDS, SPEED_TOL_FRACTION, levelSpec } from "../constants";
import {
  captureReplay,
  coreCount,
  createHarness,
  head,
  poseHall,
  speedOverTicks,
  type Harness,
} from "../harness";

/** Where the core is posed: clear of the inlet, the intake and every corner. */
const START_S = 1000;

/** One second of simulated time, the span the speed is read over. */
const TICKS = 60;

/** The level this is read on, and the feed speed its row fixes. */
const LEVEL = 1;
const FEED = levelSpec(LEVEL).feed;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("advances the lead segment at the level's feed speed", async () => {
  await poseHall(h, {
    level: LEVEL,
    pressure: 0,
    cores: [[START_S, CHARGE_IDS[0], null]],
  });
  const before = head(h.snapshot()).s;

  const after = await captureReplay(h, "advance", () => h.step(TICKS));

  assertEqual(coreCount(after), 1, "the cores on the channel after the drive");
  assertNearFraction(
    speedOverTicks(head(after).s - before, TICKS),
    FEED,
    SPEED_TOL_FRACTION,
    "the lead segment's speed, in units/s",
  );
});
