// channel/emission-cadence — the inlet places a core at the inlet as soon as the
// tail has cleared one spacing, and not before.
//
// THE SPEC LINE. `specs/channel.md`, "Emission": "While the level's quota is not
// exhausted, the inlet emits a core at `s = 0` on a tick where the tail core's
// arc position is at least `SPACING`, one core at most per tick." The same
// file's "The order of a tick" puts the emission last, at step 7, after the
// advance at step 2, so the tick on which the tail first reaches 28 is the tick
// the emission lands on.
//
// THE DRIVE. One core posed eight units short of the spacing, with cores left in
// the quota so the inlet is running. Alone on the channel it is the lead segment
// and rides at level 1's feed speed of 22 units/s, so it needs 8 / 22 of a
// second — 21.8 ticks — to clear 28, which is far enough out that the tick it
// crosses on is unambiguous and short enough that the whole cadence is read in
// under a second. The hall is stepped one tick at a time so the crossing tick
// and the emission tick are each named exactly.
//
// WHAT IS READ, IN BOTH DIRECTIONS. That no core appears while the posed core is
// still short of the spacing (every tick before the crossing carries one core),
// and that one appears on the crossing tick or the one after it, standing at the
// inlet.
//
// THE TOLERANCES. The crossing-to-emission delay is bounded at 0 ticks below and
// 1 tick above. The lower bound is not a tolerance at all — the specification
// forbids an emission while the tail is under the spacing, so any early core is
// a failure. The upper bound is one tick because the specification fixes the
// emission after the advance within the same tick, and one tick is the whole of
// the slack a build that reads its positions at the top of the tick instead
// would need; a build that emits on a timer rather than on the tail's position
// misses by many. The inlet placement is read to +/- 0.5 units, the case's
// standing tolerance for an arc position, against the stated `s = 0`.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual, assertNear, assertTrue } from "../assert";
import { ARC_TOL, SPACING } from "../constants";
import {
  captureReplay,
  coreCount,
  createHarness,
  head,
  poseHall,
  tail,
  type Harness,
} from "../harness";

/** The posed core: eight units short of the spacing, so the crossing is clean. */
const START_S = 20;

/** Cores left in the quota, so the inlet is running. */
const QUOTA = 10;

/** Ticks driven: nearly three times the 22 the crossing takes. */
const MAX_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("places a core at the inlet on the tick the tail clears the spacing", async () => {
  await poseHall(h, {
    level: 1,
    quotaRemaining: QUOTA,
    // The one point here that IS about the inlet, so its gate is let go
    // (specs/instrumentation.md, `setEmission`).
    emission: true,
    cores: [[START_S, "halide", null]],
  });

  // One tick at a time, stopping on the tick a second core is on the channel, so
  // the history names both the crossing tick and the emission tick.
  const history = await captureReplay(h, "emit", () =>
    h.stepWatching(MAX_TICKS, (snapshot) => coreCount(snapshot) >= 2),
  );

  const emitTick = history.findIndex((snapshot) => coreCount(snapshot) >= 2);
  assertTrue(
    emitTick >= 0,
    `a core placed at the inlet within ${MAX_TICKS} ticks of the tail ` +
      `clearing ${SPACING} units`,
  );

  // The crossing: the first tick the posed core — always the head, since an
  // emitted core stands behind it — reports an arc position of at least the
  // spacing.
  const reachTick = history.findIndex(
    (snapshot) => head(snapshot).s >= SPACING,
  );
  assertTrue(
    reachTick >= 0,
    `the posed core reaching ${SPACING} units within ${MAX_TICKS} ticks`,
  );

  // Nothing arrives while the tail is still short of the spacing.
  for (let tick = 0; tick < reachTick; tick += 1) {
    assertEqual(
      coreCount(history[tick]),
      1,
      `the cores on the channel on tick ${tick + 1}, before the tail cleared ` +
        `${SPACING} units`,
    );
  }

  assertBetween(
    emitTick - reachTick,
    0,
    1,
    "the ticks between the tail clearing the spacing and the emission",
  );
  assertNear(
    tail(history[emitTick]).s,
    0,
    ARC_TOL,
    "the arc position the emitted core was placed at",
  );
});
