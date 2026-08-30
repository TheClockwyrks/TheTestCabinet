// machinery/mark-cadence — every twelfth core of a level carries a mark.
//
// WHAT THE SPEC FIXES. `specs/machinery.md` ("Marks"): "The cores of a level are
// counted in the order `specs/channel.md` gives them, the twelve seeded at level
// start first and then each core the inlet emits. Every `MARK_INTERVAL` (12)
// cores in that count, the 12th, 24th, 36th and so on, one core carries a mark.
// The count restarts whenever a level starts". `specs/channel.md` ("The seeded
// cores") fixes which of the opening twelve is the twelfth: "The twelve enter in
// order from the head, so the seeded core at `s = 0` is the twelfth core of the
// level" — and `specs/instrumentation.md` reports the train "head first", so the
// opening train read head-first IS the entry order, and its last entry is the
// twelfth core.
//
// HOW THE EMITTED CORES ARE COUNTED. `specs/instrumentation.md` ("Snapshot
// shape") reports `emitted`, "The level's quota less `quotaRemaining`", and
// `specs/channel.md` decrements the quota once per emission and once per seeded
// core, so `emitted` IS the count this rule is stated in. The drive steps until
// it reaches each of 13 through 24 in turn.
//
// HOW THE NEW CORE IS IDENTIFIED. `specs/channel.md` ("Emission"): "the inlet
// emits a core at `s = 0` on a tick where the tail core's arc position is at
// least `SPACING`", and "The order of a tick" puts that emission last, after
// every advance, insertion, removal and recoil of the tick. So on the tick
// `emitted` rises the newly entered core is the one standing at arc position 0,
// which is the tail — the sweep samples every tick (`poll: 1`) so it reads that
// core on the tick it arrived, before any later tick can merge or extract it.
// The mark is read there, so the answer does not depend on the core surviving.
//
// THE TOLERANCES. There is none to pick: a mark is present or it is not, and the
// count is a whole number the snapshot reports. The only bound is how long the
// sweep waits for each emission, which is generous rather than tight — an
// emission needs the tail to ride `SPACING` out at the level's feed speed, 77
// ticks at level 1, and 600 leaves room for a build whose train was recoiled
// back by an extraction on the way.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLessThan,
  assertNotNull,
  assertNull,
  assertTrue,
} from "../assert";
import {
  MARK_INTERVAL,
  SEED_COUNT,
  SPACING,
  type MachineryKind,
} from "../constants";
import {
  captureStill,
  coreCount,
  createHarness,
  tail,
  type Harness,
} from "../harness";

/** The level the count is walked on; the rule is the same on every level. */
const LEVEL = 1;

/** The last core the drive counts to: the second mark of the level. */
const LAST_CORE = MARK_INTERVAL * 2;

/** How long the sweep waits for one emission, in ticks. */
const EMISSION_MAX_TICKS = 600;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** What the count says of the `n`th core of the level: marked, or not. */
function expectMark(n: number, mark: MachineryKind | null): void {
  const context = `the mark on core ${n} of the level`;
  if (n % MARK_INTERVAL === 0) assertNotNull(mark, context);
  else assertNull(mark, context);
}

it(`marks the ${MARK_INTERVAL}th and the ${LAST_CORE}th core of a level and none between`, async () => {
  h.debug.startLevel(LEVEL);
  // One frame, because "A pose that opens a level takes effect no later than the
  // end of the next advanced frame" (specs/instrumentation.md), so a caller
  // advances one before it poses or reads further.
  const opening = await h.step(1);
  assertEqual(
    coreCount(opening),
    SEED_COUNT,
    "the cores a level opens with, which are its first twelve",
  );
  opening.train.forEach((core, index) => expectMark(index + 1, core.mark));

  for (let n = SEED_COUNT + 1; n <= LAST_CORE; n += 1) {
    const swept = await h.stepUntil((s) => s.emitted >= n, {
      maxTicks: EMISSION_MAX_TICKS,
      poll: 1,
    });
    assertTrue(
      swept.hit,
      `core ${n} of the level entered within ${EMISSION_MAX_TICKS} ticks`,
    );
    const arrived = tail(swept.snapshot);
    assertLessThan(
      arrived.s,
      SPACING,
      `the arc position of core ${n} on the tick the inlet emitted it`,
    );
    expectMark(n, arrived.mark);
  }

  captureStill(h, "marked");
});
