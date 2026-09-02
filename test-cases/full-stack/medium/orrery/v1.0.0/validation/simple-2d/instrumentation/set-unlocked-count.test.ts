// instrumentation/set-unlocked-count — `setUnlockedCount(n)` opens a stretch of
// the campaign.
//
// THE RULE. "`setUnlockedCount(n)` — Sets how many campaign challenges are open,
// `1` to the shipped course length. The Extras lock nothing, as
// `specs/modes/extras.md` states" (`specs/instrumentation.md`, Navigation and
// progress). The snapshot carries the figure as `campaign.unlockedCount`, whose
// resting value is `1`, and `reset` leaves it there: "only the first campaign
// challenge is unlocked".
//
// WHAT BEING OPEN MEANS is `specs/modes/campaign.md`'s select screen, which is
// where a count of open challenges is observable as more than a number: "locked
// — Not yet reached. Cannot be entered", "unlocked — Reached and not yet solved.
// Can be entered", and "`confirm` on an unlocked or solved challenge opens it in
// the editor; `confirm` on a locked one does nothing."
//
// THE CONFIGURATION. A reset session, whose course holds `campaign.count`
// challenges — between `CAMPAIGN_MIN` (`8`) and `CAMPAIGN_MAX` (`16`) of them,
// so rows `1` and `2` both exist. The count is posed at `1`, at the course
// length, and at `2`: the two ends of the domain the row states and one figure
// between them. With it at `2`, row `1` — below the count — and row `2` — at it —
// are each entered from the select screen with `confirm`, which is the only route
// the specification says a locked row refuses. Nothing else is posed: no machine,
// no run, and no other progress.
//
// THE VERDICT. `campaign.unlockedCount` reads back every posed figure. With the
// count at `2`, `confirm` on row `1` opens the editor over campaign challenge
// `1`, and `confirm` on row `2` leaves the game on the select screen with no
// challenge open and the count as it stood.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
  assertNull,
} from "../assert";
import { CAMPAIGN_MAX, CAMPAIGN_MIN } from "../constants";
import {
  captureStill,
  createHarness,
  openSelect,
  openTitle,
  pressAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens exactly the stretch of the course the posed count names", async () => {
  await openTitle(h);
  const course = (await h.snapshot()).campaign.count;
  assertGreaterThanOrEqual(
    course,
    CAMPAIGN_MIN,
    "the campaign holds at least CAMPAIGN_MIN challenges",
  );
  assertLessThanOrEqual(
    course,
    CAMPAIGN_MAX,
    "the campaign holds at most CAMPAIGN_MAX challenges",
  );

  await h.debug.setUnlockedCount(1);
  assertEqual(
    (await h.snapshot()).campaign.unlockedCount,
    1,
    "1 is the bottom of the domain setUnlockedCount states",
  );
  await h.debug.setUnlockedCount(course);
  assertEqual(
    (await h.snapshot()).campaign.unlockedCount,
    course,
    "the shipped course length is the top of that domain",
  );

  await h.debug.setUnlockedCount(2);
  await openSelect(h, "campaign");
  await captureStill(h, "unlocked");
  assertEqual(
    (await h.snapshot()).campaign.unlockedCount,
    2,
    "the count reads back the figure posed last",
  );

  await h.debug.setSelectIndex(1);
  const entered = await pressAction(h, "confirm");
  assertEqual(
    entered.screen,
    "editor",
    "row 1 is below the posed count, so it is unlocked and confirm enters it",
  );
  assertEqual(
    entered.challenge?.source,
    "campaign",
    "the row entered is a campaign challenge",
  );
  assertEqual(
    entered.challenge?.index,
    1,
    "the row entered is the campaign challenge at index 1",
  );

  await h.debug.setScreen("select");
  await h.debug.setSelectIndex(2);
  const refused = await pressAction(h, "confirm");
  assertEqual(
    refused.screen,
    "select",
    "row 2 is at the posed count, so it is locked and confirm does nothing",
  );
  assertNull(
    refused.challenge,
    "a locked row opens no challenge, so none is open away from the editor",
  );
  assertEqual(
    refused.campaign.unlockedCount,
    2,
    "the refused confirm left the posed count as it stood",
  );
});
