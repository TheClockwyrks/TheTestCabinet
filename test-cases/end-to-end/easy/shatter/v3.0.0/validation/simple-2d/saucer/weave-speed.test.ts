// saucer/weave-speed — no vertical velocity the weave takes is faster than the
// stated one.
//
// THE RULE. `specs/saucer.md`: at every reroll the saucer "sets its vertical
// velocity to `SAUCER_WEAVE_SPEED` (`90`)". `90` is the only vertical figure the
// specification puts on the saucer anywhere — the steering that keeps it clear of
// the core is left to the build, but the weave's speed is fixed — so this item is
// the ceiling on what the weave puts on the field: every value the vertical
// velocity takes, over five intervals, is at most that.
//
// ONE DIRECTION ONLY, DELIBERATELY. That the weave moves the craft at all is
// `weaves-vertically`'s, and how often it rerolls is `weave-interval`'s. This one
// says only that nothing goes over, so a build with a broken weave grades against
// exactly one of the three and a build weaving at `180` fails exactly this one.
//
// TRAVEL IS OFF AND THE GUN IS OFF, for the reasons `weaves-vertically` states,
// and `(240, 620)` is `443` units from the star so the steering never runs. That
// matters more here than anywhere else in the group: the specification lets a
// build steer around the core however it likes, and a vertical speed taken to get
// out of the core's way is not a vertical speed the weave chose.
//
// WHY FIVE PERCENT. `4.5` units per second on a bound of `90`, and the item's own
// figure. A conformant build sets the figure exactly, so nothing conformant needs
// any of it; what it leaves room for is a build that reaches the figure over a
// tick rather than in one step. A build weaving at `120` is over by a third.

import { afterEach, beforeEach, it } from "vitest";
import {
  SAUCER_WEAVE_INTERVAL,
  SAUCER_WEAVE_SPEED,
} from "../../src/constants";
import { assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  theSaucer,
  ticksFor,
  type Harness,
} from "../harness";
import { poseVisit } from "./visit";

/** Where the saucer stands: far from the star, so only the weave decides. */
const STAND = { x: 240, y: 620 };

/** The five weave intervals every value is read over. */
const WATCH_TICKS = ticksFor(5 * SAUCER_WEAVE_INTERVAL);

/** How often the vertical velocity is read: every twentieth of a second. */
const SAMPLE_TICKS = 6;

/** Five percent of `SAUCER_WEAVE_SPEED`: `4.5` units per second. See the header. */
const SPEED_TOLERANCE = SAUCER_WEAVE_SPEED * 0.05;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("never lets the weave take a vertical velocity past SAUCER_WEAVE_SPEED", async () => {
  startPlaying(h);
  poseVisit(h, STAND.x, STAND.y, {
    vx: 0,
    vy: 0,
    mind: true,
    gun: false,
    travel: false,
  });

  let fastest = 0;
  for (let run = 0; run < WATCH_TICKS; run += SAMPLE_TICKS) {
    await h.advance(Math.min(SAMPLE_TICKS, WATCH_TICKS - run));
    const { vy } = theSaucer(h.snapshot(), "weave-speed");
    if (Math.abs(vy) > fastest) {
      fastest = Math.abs(vy);
      // Overwritten each time a faster value turns up, so the picture kept is
      // the tick the verdict is read off.
      captureStill(h, "weave");
    }
  }

  assertLessThanOrEqual(
    fastest,
    SAUCER_WEAVE_SPEED + SPEED_TOLERANCE,
    "the fastest vertical velocity five weave intervals produced " +
      "(specs/saucer.md)",
  );
});
