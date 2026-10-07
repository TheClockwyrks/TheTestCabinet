// channel/quota-exhausted — with the quota spent the inlet places nothing,
// however far the train rides.
//
// THE SPEC LINE. `specs/channel.md`, "Emission": "While the level's quota is not
// exhausted, the inlet emits a core at `s = 0` on a tick where the tail core's
// arc position is at least `SPACING`". `specs/progression.md` says the same from
// the level's side: "the level delivers no further core once the quota is
// exhausted." `specs/instrumentation.md`, `setQuotaRemaining`: "Sets the cores
// the inlet has left to emit this level to `n`", so posing 0 is the exhausted
// quota exactly.
//
// THE DRIVE. One core alone on a channel whose quota is spent, stepped for six
// hundred ticks — ten seconds of simulated time. The emission condition is on
// the tail's arc position, and the posed core clears the spacing within the
// first half second and then rides on for another two hundred units, so every
// one of those six hundred ticks is a tick on which a build that ignored the
// quota would have emitted. The core ends far short of the intake at 5000, so no
// cell is spent and the level cannot restart underneath the reading.
//
// THE TOLERANCE. None: a count is exact. One core was posed and one core must
// remain, so a single stray arrival at the inlet fails the point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  coreCount,
  createHarness,
  poseHall,
  type Harness,
} from "../harness";

/** Where the core is posed: clear of the inlet and nowhere near the intake. */
const START_S = 100;

/** Ten seconds of simulated time, every tick of which could have emitted. */
const TICKS = 600;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("places no core at the inlet once the quota is spent", async () => {
  await poseHall(h, {
    level: 1,
    // The inlet is the faculty this point is about, so its gate is left OPEN and
    // the quota alone is what has to stop it. A hall driven with the gate closed
    // would place nothing whatever the quota, and the reading would be vacuous.
    emission: true,
    quotaRemaining: 0,
    cores: [[START_S, "halide", null]],
  });

  const after = await h.step(TICKS);

  // Each stepped tick ends in a render (`specs/instrumentation.md`, `step`), so
  // the canvas already shows the hall the last tick left.
  await captureStill(h, "empty-inlet");

  assertEqual(
    coreCount(after),
    1,
    `the cores on the channel after ${TICKS} ticks with the quota spent`,
  );
});
