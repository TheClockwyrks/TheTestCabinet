// instrumentation/solved-set-stays-ascending-and-unique — the solved set stays
// ascending and free of duplicates.
//
// THE RULE. "`setSolved(mode, index, solved)` — Adds `index` to that mode's
// solved set when `solved` is `true`, and removes it when `false`. The set stays
// ascending and free of duplicates" (`specs/instrumentation.md`, Navigation and
// progress). The snapshot shape says the same of what it reports: `solved:
// [<number>], // ascending indices`. It is a SET, so the order the marks arrive
// in reaches neither the order it is reported in nor how many entries it holds.
//
// THE CONFIGURATION. A reset session with no challenge open, no machine and no
// run, so the marks are the only thing that touches progress. The Extras are
// marked `4`, `1`, `3` and then `1` again — out of order, and one index twice —
// and the campaign is marked `5`, `0` and `5`, so the rule is read in both of the
// mode's own sets. Every index named is inside its mode's count: the Extras hold
// `EXTRA_COUNT` (`10`), and the campaign at least `CAMPAIGN_MIN` (`8`).
//
// THE VERDICT. Each mode's reported list is the marked indices in ascending
// order, each appearing exactly once — so out-of-order marks are sorted and a
// repeated mark adds nothing.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertGreaterThanOrEqual } from "../assert";
import { CAMPAIGN_MIN, EXTRA_COUNT } from "../constants";
import {
  captureStill,
  createHarness,
  openSelect,
  openTitle,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the marked indices ascending, each exactly once", async () => {
  await openTitle(h);
  const fresh = await h.snapshot();
  assertGreaterThanOrEqual(
    fresh.extras.count,
    EXTRA_COUNT,
    "the Extras hold EXTRA_COUNT challenges, so indices 1, 3 and 4 exist",
  );
  assertGreaterThanOrEqual(
    fresh.campaign.count,
    CAMPAIGN_MIN,
    "the campaign holds at least CAMPAIGN_MIN challenges, so indices 0 and 5 exist",
  );

  for (const index of [4, 1, 3, 1]) {
    await h.debug.setSolved("extras", index, true);
  }
  for (const index of [5, 0, 5]) {
    await h.debug.setSolved("campaign", index, true);
  }

  await openSelect(h, "extras");
  await captureStill(h, "ordered");

  const marked = await h.snapshot();
  assertDeepEqual(
    marked.extras.solved,
    [1, 3, 4],
    "marks made 4, 1, 3, 1 are reported ascending with 1 appearing once",
  );
  assertDeepEqual(
    marked.campaign.solved,
    [0, 5],
    "marks made 5, 0, 5 are reported ascending with 5 appearing once",
  );
});
