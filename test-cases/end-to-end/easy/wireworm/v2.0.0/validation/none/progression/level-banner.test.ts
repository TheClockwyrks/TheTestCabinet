// progression/level-banner — the next level opens behind its banner.
//
// `specs/progression.md`, Clearing a level, step 4: "The phase becomes `banner`,
// with its timer at `BANNER_TIME`, and the next level's worm enters when that
// timer runs out." The phase table gives `BANNER_TIME` as `1.3` s and says what
// the phase is: "The level's banner is shown over the board before play begins."
// And, under The three phases of play: "When the `banner` phase's timer runs out,
// the phase becomes `active`."
//
// One requirement, read at the two ends of the one interval it fixes: the clear
// opens the banner, the banner is still up short of `BANNER_TIME`, and play is
// live past it. A build that skips the banner is `active` at the first reading;
// a build whose banner never gives way is `banner` at the last; a build that
// holds the banner for a materially different span — the respawn's `1.4` s is
// the nearest other figure in the specification, and the run carries no third —
// fails one end or the other.
//
// TOLERANCE. `0.2` s at each end, which is twenty frames of this suite's clock:
// the timer counts down against the delta of each update, so the frame the
// transition lands on depends on how the countdown was accumulated, and a build
// that starts it on the frame after the clear is still a conforming build. It is
// nowhere near wide enough to admit a banner of `1.1` s or `1.5` s.
//
// The board is left empty behind the banner: `startPlaying` shuts the worm-entry
// gate, so the next level's own worm does not enter and nothing but the phase
// timer is running.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { BANNER_TIME } from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  startPlaying,
  type Harness,
} from "../harness";
import { cutLastSegment } from "./run";

/** The level cleared, so the banner read is the one the NEXT level opens on. */
const LEVEL = 2;

/** How far the reading may sit either side of `BANNER_TIME`, in seconds. */
const SLACK = 0.2;

/** Frames to the near end of the window: the banner is still up here. */
const BEFORE_FRAMES = framesFor(BANNER_TIME - SLACK);

/** Further frames to the far end: play is live here. */
const AFTER_FRAMES = framesFor(BANNER_TIME + SLACK) - BEFORE_FRAMES;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("opens the next level on a banner that gives way after 1.3s", async () => {
  await startPlaying(h, { level: LEVEL });

  await cutLastSegment(h);

  await captureStill(h, "banner");
  const cleared = await h.snapshot();
  assertLength(
    cleared.worms,
    0,
    "precondition: the bolt removed the last segment (specs/worm.md)",
  );
  assertEqual(cleared.phase, "banner", "the phase the clear left");

  await h.advance(BEFORE_FRAMES);
  assertEqual(
    (await h.snapshot()).phase,
    "banner",
    `the phase ${BANNER_TIME - SLACK}s into the banner`,
  );

  await h.advance(AFTER_FRAMES);
  assertEqual(
    (await h.snapshot()).phase,
    "active",
    `the phase ${BANNER_TIME + SLACK}s into the banner`,
  );
});
