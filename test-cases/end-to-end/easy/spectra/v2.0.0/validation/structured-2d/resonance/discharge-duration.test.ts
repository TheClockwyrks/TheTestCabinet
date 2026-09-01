// resonance/discharge-duration — the wave is live for `DISCHARGE_TIME` from the
// action and over after it.
//
// THE RULE. specs/resonance.md: the wave "is live for `DISCHARGE_TIME` (`0.5`)
// seconds from the action", and "When the wave's time runs out it stops, and the
// game carries no wave until the next discharge." specs/instrumentation.md
// reports the live wave as `discharge.active`, which is what the snapshot is read
// for here.
//
// THE SPAN IS READ FROM BOTH SIDES, and both readings are the same requirement. A
// wave that never starts, a wave that ends in a frame and a wave that never stops
// are three different builds, and only a pair of readings — still live before the
// earliest a conforming build may stop, and over after the latest one may — tells
// them apart. The review item's own allowance is 10%.
//
// THE FRAME GRID CANNOT DECIDE THE VERDICT, which is why the two readings sit one
// frame OUTSIDE the allowance rather than on it. The harness steps at 100 Hz, so
// each frame is 0.01 s — a fiftieth of `DISCHARGE_TIME` and a fifth of the
// allowance — and the action itself lands inside a frame, so the wave's age at
// any reading is known to within one frame. Taking the first reading a frame
// early and the second a frame late puts every conforming build unambiguously on
// the right side of both.
//
// THE FIELD IS EMPTY. `startPosed` clears the rosters and shuts the wave's three
// gates, so the wave destroys nothing and pops nothing, and what is timed is the
// wave rather than any consequence of it. The meter is posed with `setResonance`
// and the action driven through its own key, because specs/instrumentation.md
// gives the surface no operation that discharges.
//
// WHAT THIS DOES NOT DECIDE. That the action spends the meter is
// `resonance/discharge-spends`; what the wave destroys over that span is the rest
// of this directory.

import { afterEach, beforeEach, it } from "vitest";
import { DISCHARGE_TIME } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  seconds,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import { release } from "./wave";

/** The allowance the review item states on the wave's span: 10%. */
const SPAN_TOLERANCE = 0.1;

/** The shortest span a conforming build may run, in seconds. */
const MIN_SPAN = DISCHARGE_TIME * (1 - SPAN_TOLERANCE);

/** The longest span a conforming build may run, in seconds. */
const MAX_SPAN = DISCHARGE_TIME * (1 + SPAN_TOLERANCE);

/**
 * Frames of the action's own span at which the wave must still be live.
 *
 * One frame short of `MIN_SPAN`, counted from and including the frame the key was
 * delivered on. The action is taken somewhere inside that first frame, so the
 * wave's age here is between `seconds(TICKS_STILL_LIVE - 1)` and
 * `seconds(TICKS_STILL_LIVE)` — 0.43 s to 0.44 s — and a build running the
 * shortest span the allowance permits, 0.45 s, is still live at either end of
 * that.
 */
const TICKS_STILL_LIVE = ticksFor(MIN_SPAN) - 1;

/**
 * Frames of the action's own span by which the wave must be over.
 *
 * Two frames past `MAX_SPAN`, on the same counting: the wave's age here is
 * between 0.56 s and 0.57 s, so a build running the longest span the allowance
 * permits, 0.55 s, has stopped at either end of it.
 */
const TICKS_OVER = ticksFor(MAX_SPAN) + 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the wave live across DISCHARGE_TIME and stops it after", async () => {
  startPosed(h);

  const readings = await captureReplay(h, "span", async () => {
    // `release` fills the meter and taps the discharge key, running the one frame
    // that delivers the press: that frame is the first of the span.
    await release(h);
    const started = h.snapshot();

    await h.advance(TICKS_STILL_LIVE - 1);
    const live = h.snapshot();

    await h.advance(TICKS_OVER - TICKS_STILL_LIVE);
    const over = h.snapshot();

    return { started, live, over };
  });

  assertEqual(
    readings.started.discharge.active,
    true,
    "precondition: the action released a wave at all (specs/resonance.md, " +
      "and controls/discharge-x)",
  );
  assertEqual(
    readings.live.discharge.active,
    true,
    `discharge.active ${seconds(TICKS_STILL_LIVE)} seconds after the action: ` +
      `still live, since the wave runs for DISCHARGE_TIME ` +
      `(${DISCHARGE_TIME}) and the shortest span the item's 10% allowance ` +
      `permits is ${MIN_SPAN} (specs/resonance.md)`,
  );
  assertEqual(
    readings.over.discharge.active,
    false,
    `discharge.active ${seconds(TICKS_OVER)} seconds after the action: over, ` +
      `since the wave runs for DISCHARGE_TIME (${DISCHARGE_TIME}), the ` +
      `longest span the item's 10% allowance permits is ${MAX_SPAN}, and the ` +
      `game carries no wave once its time runs out (specs/resonance.md)`,
  );
});
