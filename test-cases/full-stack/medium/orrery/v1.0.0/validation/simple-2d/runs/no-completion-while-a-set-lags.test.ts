// runs/no-completion-while-a-set-lags — EVERY set, not any set.
//
// THE RULE. "After the rises, if EVERY SET'S tally has reached the challenge's
// `target`, the run completes" (`specs/simulation.md`, Completion and metrics).
// A challenge may ask for more than one product — `specs/formats.md` makes
// `products` "a non-empty list of molecules" and the tray "one `set` per product,
// in product order" (`specs/editor.md`) — and the snapshot carries the tallies
// "one entry per product" (`specs/instrumentation.md`). So a challenge of two
// products is finished by two sets, and one of them being finished is not the
// same thing.
//
// THE CONFIGURATION is the two-product challenge with both of its sets placed,
// well apart, and their tallies posed on either side of the line: product `0`'s
// tally is at the target and product `1`'s is one short. Nothing is on the field
// to deliver, so the boundary the check runs to is exactly the moment the rule is
// about — one satisfied set, one lagging — and no delivery can shift either
// tally under it.
//
// THE VERDICT. The run is still `running` at that boundary with no metrics
// recorded, `sim.cycle` has incremented, and the two tallies are still where they
// were posed. The satisfied tally is read back as having reached the target, so
// the check cannot pass by having failed to satisfy the first set at all.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThan,
  assertNotNull,
  assertNull,
} from "../assert";
import { CONSTELLATION_TARGET } from "../constants";
import { setPart, solution } from "../formats";
import { EAST, TWO_AND_TWO, WEST } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  openRun,
  tallyOf,
  type Harness,
} from "../harness";

/** The whole machine: one set per product, well apart from each other. */
const BOTH_SETS = solution([
  setPart(0, WEST.q, WEST.r),
  setPart(1, EAST.q, EAST.r),
]);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("does not complete while one of two sets is still short of the target", async () => {
  await openRun(h, { challenge: TWO_AND_TWO, machine: BOTH_SETS });

  const opened = await h.snapshot();
  assertEqual(
    opened.challenge?.products.length,
    2,
    "the posed challenge asks for two products, so the machine holds two sets",
  );
  assertEqual(
    opened.challenge?.target,
    CONSTELLATION_TARGET,
    "the posed challenge asks for CONSTELLATION_TARGET of each",
  );

  await h.debug.setTally(0, CONSTELLATION_TARGET);
  await h.debug.setTally(1, CONSTELLATION_TARGET - 1);

  const before = await h.snapshot();
  assertGreaterThanOrEqual(
    tallyOf(before, 0) ?? -1,
    CONSTELLATION_TARGET,
    "the first set has reached the target, so one of the two really is satisfied",
  );
  assertLessThan(
    tallyOf(before, 1) ?? -1,
    CONSTELLATION_TARGET,
    "the second set has not reached the target",
  );

  await captureReplay(h, "lagging", () => advanceCycles(h, 1));

  const after = await h.snapshot();
  assertNotNull(after.sim, "the run is still live");
  assertEqual(
    tallyOf(after, 0),
    CONSTELLATION_TARGET,
    "nothing was delivered, so the satisfied tally is where it was posed",
  );
  assertEqual(
    tallyOf(after, 1),
    CONSTELLATION_TARGET - 1,
    "and the lagging tally is where it was posed",
  );
  assertEqual(
    after.sim?.status,
    "running",
    "one satisfied set does not complete a two-product challenge",
  );
  assertNull(
    after.sim?.metrics ?? null,
    "no metrics are recorded, because the run did not complete",
  );
  assertEqual(
    after.sim?.cycle,
    1,
    "the boundary did not complete, so sim.cycle incremented",
  );
});
