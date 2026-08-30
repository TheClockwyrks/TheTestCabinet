// progression/level-banner — the next level opens on its banner, for BANNER_TIME.
//
// THE RULE. `specs/progression.md`, *Clearing a level*, step 4: *the phase becomes
// `banner`, with its timer at `BANNER_TIME`*, and, from *The three phases of
// play*: *when the `banner` phase's timer runs out, the phase becomes `active`*.
// `BANNER_TIME` is `1.3` s.
//
// ONE INTERVAL, READ AT BOTH ENDS. The two readings are the same window seen from
// its two sides: the phase is `banner` a moment after the clear, and it is
// `active` once `BANNER_TIME` has gone by. A build that never raises the banner
// fails the first; a build that raises one and never lowers it fails the second; a
// build that flashes it for a frame fails the first. Reading only the second would
// pass all three.
//
// The clear is driven by a real shot into a motionless one-segment worm, exactly
// as `progression/level-clears-on-last-segment` drives it, because the banner this
// point is about is the one a CLEAR opens. The worm-entry gate stays off, so the
// banner gives way to an empty board and the phase is the only thing that changes.

import { afterEach, beforeEach, it } from "vitest";
import { BANNER_TIME } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { poseStillWorm, shootUpAt } from "./scenario";

/** The level cleared, and where its lone segment stands. */
const LEVEL = 2;
const WORM_COL = 20;
const WORM_ROW = 8;

/**
 * The ceiling on the sweep that waits for the shot to land, in frames. One second,
 * against a bolt at `BOLT_SPEED` (`900` units per second) posed three tiles below
 * its target (`specs/cursor.md`).
 */
const SHOT_FRAMES = ticksFor(1);

/**
 * Frames between the clear and the first reading.
 *
 * Two, so a build that raises the banner at the end of its own update is read
 * fairly. It is a sixtieth of `BANNER_TIME` (`1.3` s), so a banner that is genuinely
 * up is still up.
 */
const BANNER_SETTLE_FRAMES = 2;

/**
 * Frames run after the first reading, so that strictly more than `BANNER_TIME` has
 * passed since the clear once the settling frames above are counted in.
 */
const PAST_BANNER_FRAMES = ticksFor(BANNER_TIME) + 2;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("opens the next level on its banner and gives way BANNER_TIME later", async () => {
  startPlaying(harness);
  harness.debug.setLevel(LEVEL);
  poseStillWorm(harness, WORM_COL, WORM_ROW);
  shootUpAt(harness, WORM_COL, WORM_ROW);

  await harness.until((s) => s.worms.length === 0, { maxFrames: SHOT_FRAMES });
  await harness.advance(BANNER_SETTLE_FRAMES);

  captureStill(harness, "banner");
  assertEqual(harness.snapshot().phase, "banner", "just after the clear");

  await harness.advance(PAST_BANNER_FRAMES);

  assertEqual(
    harness.snapshot().phase,
    "active",
    "once BANNER_TIME has passed",
  );
});
