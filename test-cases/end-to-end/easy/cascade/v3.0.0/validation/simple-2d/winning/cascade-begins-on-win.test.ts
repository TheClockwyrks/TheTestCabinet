// winning/cascade-begins-on-win — the first card launches on the cascade's first
// frame.
//
// THE RULE. specs/victory.md: "The victory cascade begins with the win", and the
// launch clock "holds `LAUNCH_INTERVAL` (`0.18`) when the cascade begins, so the
// first card launches on the cascade's first frame." That opening value is the
// whole of what this point decides. It is why the cascade is not silent for a fifth
// of a second after the win, and it is what makes the count the specification
// states — "after `t` seconds of a running cascade exactly
// `floor(t / LAUNCH_INTERVAL) + 1` cards have launched" — start at one rather than
// at nought.
//
// A build that starts its clock at `0` instead is wrong in exactly one way: every
// launch is one interval late. That is invisible to `cascade/launch-cadence`, which
// reads the MEAN GAP between launches and would see the same interval; it shows up
// only here, on the first frame, and it shows up as a number — `launched` is `0`
// where the specification requires `1`.
//
// WHY THE FIRST FRAME IS DECIDED AT EXACTLY ONE CARD. The clock opens holding the
// interval, the frame adds its delta, and while the clock holds at least the
// interval one card launches and the interval is subtracted. At the suite's
// `1/240` s that leaves `0.004…` s on the clock, far under the interval, so the
// loop stops. So a conformant build launches exactly one card on that frame — not
// none, and not the whole deck — whatever step it is driven at, because the clock
// already holds the interval before the delta is added.
//
// THE READING IS TAKEN AT THE WIN AND AFTER ONE FRAME, and no scenario reaches
// between them. `startCascade` wins the game through the build's own move rules and
// advances nothing, so `launched` is read at the moment the cascade began and again
// at the end of its first frame. The frames after that are recorded as evidence and
// nothing is read from them: the cadence they show is `cascade/launch-cadence`, the
// order `cascade/launch-cycles-foundations`, and the arc `cascade/gravity`.
//
// The trail is left painting, as the other two `winning` replays leave it: the
// recording is a fraction of a second long, and the trail is most of what the
// cascade looks like.

import { afterEach, beforeEach, it } from "vitest";
import { LAUNCH_INTERVAL } from "../../src/constants";
import { assertEqual, assertLength } from "../assert";
import {
  captureReplay,
  createHarness,
  framesFor,
  startCascade,
  type Harness,
} from "../harness";

/** The cards a conformant build has launched by the end of the cascade's first frame. */
const FIRST_FRAME_LAUNCHES = 1;

/**
 * Frames recorded after the first one, as evidence rather than as measurement.
 *
 * Two launch intervals (`LAUNCH_INTERVAL` is `0.18` s, specs/victory.md), so the
 * reviewer sees the first card leave and the next follow it. Nothing is asserted
 * over them.
 */
const TAIL_FRAMES = framesFor(2 * LAUNCH_INTERVAL);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("launches its first card on the first frame after the win", async () => {
  startCascade(harness);

  const won = harness.snapshot();
  assertEqual(
    won.screen,
    "won",
    "the screen the winning move left, which is where the cascade runs " +
      "(specs/screens.md)",
  );
  assertEqual(
    won.launched,
    0,
    "cards launched at the moment the cascade began, before any frame of it " +
      "had run (specs/victory.md)",
  );
  assertLength(
    won.flyers,
    0,
    "cards in flight at the moment the cascade began (specs/victory.md)",
  );

  const first = await captureReplay(harness, "first-frames", async () => {
    await harness.advance(1);
    const opened = harness.snapshot();
    await harness.advance(TAIL_FRAMES);
    return opened;
  });

  assertEqual(
    first.launched,
    FIRST_FRAME_LAUNCHES,
    "cards launched at the end of the cascade's FIRST frame: the launch clock " +
      "holds LAUNCH_INTERVAL when the cascade begins, so one card leaves on " +
      "that frame (specs/victory.md)",
  );
  assertLength(
    first.flyers,
    FIRST_FRAME_LAUNCHES,
    "cards in flight at the end of the cascade's first frame, a launched card " +
      "taking no motion in the frame it launched on (specs/victory.md)",
  );
});
