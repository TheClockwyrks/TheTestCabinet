// campaign/course-within-bounds — the course holds between eight and sixteen
// challenges.
//
// THE RULE. "The campaign holds between `CAMPAIGN_MIN` (`8`) and `CAMPAIGN_MAX`
// (`16`) challenges, authored as fixed data in the challenge format of
// `specs/formats.md` and shipped in the build. The count is yours to choose
// within those bounds; the set is the same in every session, in a fixed order,
// numbered from `1`" (`specs/modes/campaign.md`, The course).
//
// WHERE THE COUNT IS READ. `campaign.count` is "how many challenges the shipped
// course holds" (`specs/instrumentation.md`, Snapshot shape), and "the shape is
// fixed, and every field is present whatever the screen and mode" — so the
// reading needs nothing posed beyond a session that has just started, which is
// what a fresh harness leaves.
//
// THE POSE. The title screen a `reset` restores, then the campaign's select
// screen, which is the screen that lists the course this figure counts.
//
// THE VERDICT. `campaign.count` is at least `CAMPAIGN_MIN` and at most
// `CAMPAIGN_MAX`. Nothing here reads WHICH challenges the course holds: the
// course is the build's own invention and only its length is fixed.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween } from "../assert";
import { CAMPAIGN_MAX, CAMPAIGN_MIN } from "../constants";
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

it("ships between CAMPAIGN_MIN and CAMPAIGN_MAX challenges", async () => {
  await openTitle(h);
  await openSelect(h, "campaign");
  await captureStill(h, "select");

  const count = (await h.snapshot()).campaign.count;
  assertBetween(
    count,
    CAMPAIGN_MIN,
    CAMPAIGN_MAX,
    "the campaign course holds between CAMPAIGN_MIN and CAMPAIGN_MAX challenges",
  );
});
