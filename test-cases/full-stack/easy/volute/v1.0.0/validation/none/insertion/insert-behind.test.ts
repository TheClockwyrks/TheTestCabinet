// insertion/insert-behind — a shot arriving from behind seats behind.
//
// THE SPEC LINES. `specs/injector.md`, "Striking a core": the core "enters
// **ahead** of `c` when `dot(d - c.position, f)` is greater than `0`, and
// **behind** `c` otherwise, so a dot product of exactly `0` enters behind". And
// "Insertion": "The insertion position `p` is ... `c`'s arc position minus the
// channel spacing when it enters behind. ... Cores ahead of `p` hold their arc
// positions".
//
// Read together for a hall holding one core: the seated core takes `c.s - 28`,
// and the struck core — ahead of that — holds where it stands. The seated core
// therefore ends BEHIND the core it struck, which is what the review item states.
//
// This is `insert-ahead`'s complement and is posed identically to it, on the
// straight top run where `forward` is `+x` (specs/channel.md's vertex table), so
// the side the shot arrives on is the one thing that differs between the two. A
// build that seats every shot behind the core it struck passes `insert-behind`
// and fails `insert-ahead`, and a build that seats every shot ahead does the
// reverse — which is exactly why the case grades the two separately.
//
// THE TOLERANCE — there is none, for the reason `insert-ahead` gives: the reading
// is which of the two cores afterwards carries the charge the shot was fired
// with. The arrangement puts the shot's path 14 units to the `-x` side of the
// core's centre, half the 28-unit strike distance, so the contact is unambiguous
// and the dot product is `-14` against a train that advances `22 / 60 = 0.37`
// units in the tick the strike resolves on.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import { STRIKE_DISTANCE } from "../constants";
import {
  captureReplay,
  coreCount,
  createHarness,
  head,
  poseHall,
  tail,
  topRunS,
  type Harness,
} from "../harness";
import {
  approach,
  assertInFlight,
  PLUMB_SHOT_X,
  SHOT,
  STAGE,
  UP_AIM,
} from "./stage";

/** How far along `+x` of the shot's path the struck core's centre stands. */
const LAG = 14;

/** The charge the posed core carries: not the shot's, so nothing can extract. */
const TARGET = "halide";

/** Ticks driven after the strike, so the replay shows the pair riding on. */
const SETTLE = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("seats the fired core behind the core it struck from behind", async () => {
  assertGreaterThan(
    STRIKE_DISTANCE,
    LAG,
    "the arrangement is inside the strike distance",
  );

  await poseHall(h, STAGE);

  const after = await captureReplay(h, "behind", async () => {
    const short = await approach(h, UP_AIM);
    assertInFlight(short);
    // The struck core stands LAG units ahead of the shot's path in `x`, so at the
    // strike `dot(d - c.position, forward)` is `-LAG`: the shot arrives behind.
    await h.debug.poseTrain([[topRunS(PLUMB_SHOT_X + LAG), TARGET, null]]);
    const struck = await h.step(1);
    await h.step(SETTLE);
    return struck;
  });

  assertEqual(coreCount(after), 2, "the shot seated into the train");
  assertEqual(
    tail(after).charge,
    SHOT,
    "the fired core holds the lesser arc position: it entered behind the core " +
      "it struck (specs/injector.md, Insertion)",
  );
  assertEqual(
    head(after).charge,
    TARGET,
    "the struck core holds the greater arc position",
  );
  assertLessThan(
    tail(after).s,
    head(after).s,
    "the seated core stands behind on the channel",
  );
});
