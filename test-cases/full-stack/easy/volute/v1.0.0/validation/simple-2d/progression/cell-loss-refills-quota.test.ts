// progression/cell-loss-refills-quota — a spent cell refills the quota to what a
// level start leaves it.
//
// THE SPEC LINE. `specs/progression.md` — "Cells" — gives the row exactly:
//
//   | Quota | what a level start leaves it |
//
// and the same file fixes what that is: "A level begins with ... the quota at the
// level's full value less the cores the channel opens with", the seed being
// `specs/channel.md`'s "`12` cores already on the channel". So on level 1 that is
// 45 less 12, which is 33 — computed here from `LEVELS` and `SEED_COUNT` rather
// than spelled.
//
// THE DRIVE is `progression/setback`'s shared staging: the quota is posed at 20
// through `setQuotaRemaining`, below the 33 a level start leaves, so a build that
// refills nothing reports 20 back and a build that refills to the level's FULL
// quota reports 45.
//
// TOLERANCE. None: the quota is a count the case grades exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SEED_COUNT, levelSpec } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { LEVEL, PART_SPENT_QUOTA, driveSetback } from "./setback";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refills the quota to what a level start leaves it when a cell is spent", async () => {
  const { posed, after } = await driveSetback(h);
  await captureStill(h, "quota");

  assertEqual(
    posed.quotaRemaining,
    PART_SPENT_QUOTA,
    "the part-spent quota before the cell was spent",
  );
  assertEqual(
    after.quotaRemaining,
    levelSpec(LEVEL).quota - SEED_COUNT,
    "the quota after the cell was spent, which is what a level start leaves it",
  );
});
