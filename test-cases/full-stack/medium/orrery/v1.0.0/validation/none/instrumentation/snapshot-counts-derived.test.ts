// instrumentation/snapshot-counts-derived — the campaign's count is its course's
// length, not a number carried beside it.
//
// THE RULE. `specs/instrumentation.md`, Snapshot shape, annotates the field where
// it declares it — "count: <number>, // how many challenges the shipped course
// holds" — and lists it among the derived ones: "`campaign.count`, `extras.count`
// — the length of each mode's challenge list". `specs/modes/campaign.md` bounds
// that length: "The campaign holds between `CAMPAIGN_MIN` (`8`) and `CAMPAIGN_MAX`
// (`16`) challenges... The count is yours to choose within those bounds."
//
// HOW A DERIVED COUNT IS TOLD FROM A CARRIED ONE. By reaching the list itself.
// `specs/instrumentation.md` fixes the bound `openChallenge` applies: "an `index`
// outside that mode's challenge count throws an `Error` naming the bounds", and "A
// locked row opens like any other", so nothing about progress stands between this
// check and the whole course. If `count` is the length of the list, then every
// index below it opens and the index at it does not.
//
// THE CONFIGURATION. A reset session. `count` is read, checked against the bounds
// `specs/modes/campaign.md` fixes, and then walked: every index from `0` to
// `count - 1` is opened in turn and reports itself as that mode's challenge at
// that index, and `count` itself is refused.
//
// THE VERDICT. The number the snapshot reports is exactly the number of indices
// `openChallenge` reaches — no fewer, and not one more.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual, assertNotNull } from "../assert";
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

it("reports as many challenges as openChallenge reaches", async () => {
  await openTitle(h);
  const count = (await h.snapshot()).campaign.count;
  await openSelect(h, "campaign");
  await captureStill(h, "counts");
  assertBetween(
    count,
    CAMPAIGN_MIN,
    CAMPAIGN_MAX,
    "the campaign holds between CAMPAIGN_MIN and CAMPAIGN_MAX challenges",
  );

  for (let index = 0; index < count; index += 1) {
    await h.debug.openChallenge("campaign", index);
    const opened = await h.snapshot();
    assertNotNull(
      opened.challenge,
      `campaign challenge ${index} opens, locked or not`,
    );
    assertEqual(
      opened.challenge?.source,
      "campaign",
      `challenge ${index} reports the mode it came from`,
    );
    assertEqual(
      opened.challenge?.index,
      index,
      `challenge ${index} reports the index it was opened at`,
    );
  }

  await h.debug.setScreen("title");
  let outcome = "opened";
  try {
    await h.debug.openChallenge("campaign", count);
  } catch {
    outcome = "threw";
  }
  assertEqual(
    outcome,
    "threw",
    "the index at the reported count is outside the course, so openChallenge refuses it",
  );
  assertEqual(
    (await h.snapshot()).campaign.count,
    count,
    "the count is the same figure after the walk as before it",
  );
});
