// progression/cell-loss-refills-quota — a spent cell refills the level's quota.
//
// THE SPEC LINE. `specs/progression.md` — "Cells", one row of the table a spend
// sets the run back by: "| Quota | what a level start leaves it |". What a level
// start leaves it is fixed by the same file: "A level begins with ... the quota at
// the level's full value less the cores the channel opens with", the cores being
// `specs/channel.md`'s "`12` cores already on the channel". On level 1 that is
// 45 less 12, and both figures are read from `constants.ts` rather than spelled
// here.
//
// THE POSE. The quota is set to 20, below the 33 a level-1 start leaves, so a
// build that never refills it reports 20 back. Nothing else is moved off its
// opening value.
//
// THE INLET IS HELD, so nothing the inlet emits spends the quota under the
// reading: `poseHall` sets `setEmission(false)`, which
// `specs/instrumentation.md` says leaves the quota where it stands. The count
// the spend leaves is therefore the refill and nothing else.
//
// TOLERANCE. None: a quota is a whole count and the case grades it exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SEED_COUNT, levelSpec } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { driveArrival, LEVEL } from "./setback";

/** A quota below the 33 a level-1 start leaves, so "refilled" is readable. */
const PART_SPENT = 20;

/** "the level's full value less the cores the channel opens with". */
const AFTER_A_LEVEL_START = levelSpec(LEVEL).quota - SEED_COUNT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refills the quota to what a level start leaves it when a cell is spent", async () => {
  const setback = await driveArrival(h, { quotaRemaining: PART_SPENT });
  await captureStill(h, "quota");

  assertEqual(
    setback.posed.quotaRemaining,
    PART_SPENT,
    "the part-spent quota before the setback",
  );
  assertEqual(
    setback.spent.quotaRemaining,
    AFTER_A_LEVEL_START,
    "the quota after the cell was spent, which is what a level start leaves it",
  );
});
