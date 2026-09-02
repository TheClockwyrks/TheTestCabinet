// saucer/weaves-vertically — the weave really does send the saucer up and then
// down again.
//
// THE RULE. `specs/saucer.md`: every `SAUCER_WEAVE_INTERVAL` the saucer "sets its
// vertical velocity to `SAUCER_WEAVE_SPEED` DIRECTED OPPOSITE the vertical
// direction it is travelling in at that moment, so its vertical direction
// reverses at every reroll." So over four intervals a conformant build reverses
// three times, and this item asks for at least two — which a build that picks one
// vertical direction and holds it, or one that never weaves at all, cannot
// produce.
//
// TRAVEL IS OFF, WHICH IS THE ISOLATION THE FACULTIES BUY. The requirement is a
// DECISION, and with locomotion off the decision is read as a velocity on a craft
// that has not moved an inch — so nothing in the reading can be the wrap, the
// crossing, or a course the star's neighbourhood argued the saucer out of. The
// gun is off too: a shot would carry the saucer's velocity onto the field and add
// a body this check would have to explain. `specs/instrumentation.md` fixes that
// a held saucer "still rerolls its weave", which is what makes this poseable at
// all.
//
// WHERE IT STANDS. `(240, 620)` is `443` units from the star, far outside
// anything `specs/saucer.md` gives the core, so the OTHER thing the mind decides
// — the steering that keeps it clear of the core — never runs and the reading is
// the weave alone.
//
// THE CLIP DOES NOT END ON THE MEASUREMENT. The reading is taken over the four
// intervals the saucer stands still for; the recording then hands its locomotion
// back and lets the same weave carry it, so what a reviewer watches is the weave
// doing something rather than four seconds of a stationary disc. Nothing after
// the reading can reach it: every sample the assertion counts was taken before
// the travel was turned on.

import { afterEach, beforeEach, it } from "vitest";
import { SAUCER_WEAVE_INTERVAL } from "../constants";
import { assertGreaterThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  startPlaying,
  theSaucer,
  ticksFor,
  type Harness,
} from "../harness";
import { poseVisit } from "./visit";

/** Where the saucer stands: far from the star, so only the weave decides. */
const STAND = { x: 240, y: 620 };

/** The four weave intervals the reading is taken over. */
const WATCH_TICKS = ticksFor(4 * SAUCER_WEAVE_INTERVAL);

/**
 * How often the vertical velocity is read: every twentieth of a second.
 *
 * Not a tolerance. The weave holds one velocity for a whole interval, so any
 * stride well inside an interval sees every value it takes; this one sees each of
 * them twenty times over.
 */
const SAMPLE_TICKS = 6;

/** The reversals four intervals must show: the item's own figure. */
const REVERSALS_NEEDED = 2;

/** A moment of the weave under way, filmed after the reading. See the header. */
const FLIGHT_TICKS = ticksFor(2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reverses the saucer's vertical direction at least twice over four intervals", async () => {
  startPlaying(h);
  poseVisit(h, STAND.x, STAND.y, {
    vx: 0,
    vy: 0,
    mind: true,
    gun: false,
    travel: false,
  });

  const reversals = await captureReplay(h, "weave", async () => {
    let previous = 0;
    let seen = 0;
    for (let run = 0; run < WATCH_TICKS; run += SAMPLE_TICKS) {
      await h.advance(Math.min(SAMPLE_TICKS, WATCH_TICKS - run));
      const { vy } = theSaucer(h.snapshot(), "weaves-vertically");
      if (vy !== 0 && previous !== 0 && Math.sign(vy) !== Math.sign(previous)) {
        seen += 1;
      }
      if (vy !== 0) previous = vy;
    }
    h.debug.setSaucerTravel(true);
    await h.advance(FLIGHT_TICKS);
    return seen;
  });

  assertGreaterThanOrEqual(
    reversals,
    REVERSALS_NEEDED,
    "the times the saucer's vertical direction reversed over four weave " +
      "intervals (specs/saucer.md)",
  );
});
