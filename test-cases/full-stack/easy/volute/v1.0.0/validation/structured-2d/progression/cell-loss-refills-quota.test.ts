// progression/cell-loss-refills-quota — a spent cell refills the level's quota.
//
// THE SPEC LINE. `specs/progression.md` — "Cells", one row of the table a spend
// sets the run back by:
//
//   | Quota | what a level start leaves it |
//
// One row, one point. `progression/setback.ts` carries the drive every row is
// read off; this file reads the quota and nothing else.
//
// WHAT A LEVEL START LEAVES IT AT is fixed by the same file: "A level begins with
// ... the quota at the level's full value less the cores the channel opens with",
// the seed being `specs/channel.md`'s "`12` cores already on the channel". On
// level 1 that is 45 less 12, and both figures come from `constants.ts` rather
// than from the build.
//
// THE TOLERANCE. None: the quota is a count and the case grades it exactly.

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
  const drive = await driveSetback(h);
  captureStill(h, "quota");

  assertEqual(
    drive.posed.quotaRemaining,
    PART_SPENT_QUOTA,
    "the part-spent quota before the setback",
  );
  assertEqual(
    drive.after.quotaRemaining,
    levelSpec(LEVEL).quota - SEED_COUNT,
    "the quota after the cell was spent, which is what a level start leaves it",
  );
});
