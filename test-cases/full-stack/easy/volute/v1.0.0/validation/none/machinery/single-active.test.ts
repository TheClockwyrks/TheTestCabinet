// machinery/single-active — a fresh timed grant replaces the one already running.
//
// WHAT THE SPEC FIXES. `specs/machinery.md` ("The active machinery"): "At most
// one of `choke`, `backflow` and `sightline` is active at a time. A grant of any
// of the three becomes the active machinery, replacing whatever was active and
// starting its full duration afresh". `specs/instrumentation.md`
// (`grantMachinery`) says the same of the operation this drive poses through:
// the three "become the active machinery at their full duration, replacing
// whatever was active and restarting its timer."
//
// WHAT "ALONE" IS READ AS. Two readings, both of the one replacement. The
// snapshot's `machinery` names the kind and its seconds left, so a sightline
// granted over a running choke reports `sightline` at its full 12 s. And the
// snapshot's `feedSpeed` is "the effective feed speed" — `specs/channel.md`
// multiplies it by "the choke factor", which "is `1` while no choke is active" —
// so a hall whose choke was really replaced reports the level's own feed speed
// rather than four tenths of it. A build that stacked the second grant on the
// first would report one or the other wrongly.
//
// AND WHAT THIS POINT DOES NOT DECIDE. The sentence the rule is written in ends
// "including a grant of the kind already active", which is a second thing a build
// implements on its own — a build that keys its grant off "is the active kind
// different?" replaces correctly and ignores a re-grant of the running kind. That
// is `machinery/regrant-restarts`.
//
// THE TOLERANCES. The kind is an equality, not a measurement. The duration is
// read with no tick stepped since the grant, so an ideal build reports exactly
// 12 s and the case's standing duration tolerance of 2 ticks (0.033 s) is slack
// for a build that has already taken this tick's decrement off it. The feed
// speed is read one tick later, against the case's standing speed tolerance of
// 2% — and the choked rate it must not be is 60% away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNotNull } from "../assert";
import {
  MACHINERY_DURATION,
  TICK_DT,
  TICK_HZ,
  TICK_TOL,
  effectiveFeed,
  speedTolerance,
} from "../constants";
import {
  captureStill,
  createHarness,
  poseHall,
  type Harness,
} from "../harness";

/** The level the drive opens on, whose feed speed the specs fix at 22. */
const LEVEL = 1;

/** Where the lone core is posed, so the reported feed speed has a segment to drive. */
const CORE_S = 1000;

/** The kind granted first, and the one granted over it. */
const FIRST = "choke";
const SECOND = "sightline";

/** Ticks of the first grant run off before the second replaces it. */
const HELD_TICKS = TICK_HZ;

/** The free rate the specs give once the choke is gone: 22 x (1 + 0 / 100) x 1. */
const FREE_FEED = effectiveFeed(LEVEL, 0, false);

/** The duration `specs/machinery.md` gives the kind the drive grants twice. */
const SECOND_DURATION = MACHINERY_DURATION[SECOND];

/** The +/- 2 ticks the case's standing tolerances put on a duration, in seconds. */
const DURATION_TOL = TICK_TOL * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it(`reports ${SECOND} at its full duration when it is granted over a running ${FIRST}`, async () => {
  await poseHall(h, {
    level: LEVEL,
    pressure: 0,
    cores: [[CORE_S, "halide", null]],
    machinery: FIRST,
  });
  await h.step(HELD_TICKS);

  await h.debug.grantMachinery(SECOND);
  const granted = await h.snapshot();
  const running = await h.step();
  await captureStill(h, "replaced");

  assertNotNull(
    granted.machinery,
    "the active machinery after the second grant",
  );
  assertEqual(
    granted.machinery?.kind,
    SECOND,
    `the kind left active by a ${SECOND} granted over a running ${FIRST}`,
  );
  assertNear(
    granted.machinery?.remaining ?? Number.NaN,
    SECOND_DURATION,
    DURATION_TOL,
    `the seconds left on a ${SECOND} started afresh`,
  );
  assertNear(
    running.feedSpeed,
    FREE_FEED,
    speedTolerance(FREE_FEED),
    `the effective feed speed once the ${FIRST} has been replaced`,
  );
});
