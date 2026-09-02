// extras/select-lands-on-row-one-before-any — the shelf opens on row 1 until an
// Extras challenge has been entered, whatever the campaign has been up to.
//
// THE RULE. The Extras select screen's highlight and "its resting position on
// arrival" are as `specs/modes/campaign.md` states them
// (`specs/modes/extras.md`, The select screen), and that file states: "On arriving
// at the screen the highlight sits on the challenge most recently entered or
// solved, and on challenge `1` before any has been entered."
//
// EACH MODE KEEPS ITS OWN FIGURE. The two modes are two courses — "`state.mode` is
// `campaign` or `extras`, and decides which course the `select` and `editor`
// screens serve" (`specs/ui.md`) — and the snapshot carries the resting row once
// per mode, as `campaign.last` and `extras.last`, "where the select screen lands"
// (`specs/instrumentation.md`). A reset leaves "both select screens land[ing] on
// their first row". So entering a challenge in one mode says nothing about where
// the other mode's screen lands, and that is what this point decides.
//
// THE CONFIGURATION. A fresh session in which the campaign is opened to its first
// four challenges through `setUnlockedCount` — "`confirm` on an unlocked or solved
// challenge opens it in the editor; `confirm` on a locked one does nothing"
// (`specs/modes/campaign.md`) — and campaign challenge 4 is then ENTERED the way a
// player enters one: from its select screen, with the highlight moved onto its row
// and `confirm` pressed. The editor is left with `back`, which "returns to that
// select screen" (`specs/editor.md`), and the select screen with `back`, which
// "returns to the title". Nothing has touched the Extras: no Extras challenge has
// been entered, none is solved, and no record has been set.
//
// THE READING THAT KEEPS IT HONEST. The campaign's own resting row is read back as
// `3`, the row of the challenge just entered. Without it, a build that records
// nothing anywhere would land the Extras on row 1 for the wrong reason and pass;
// with it, the only way to pass is to have recorded the campaign's entering AND
// kept it out of the Extras' figure.
//
// THE VERDICT. Arriving at the Extras select screen puts the highlight on row 1 —
// `selectIndex` `0` — and the Extras' resting row is still `0`, while the campaign's
// is the challenge that was entered.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThanOrEqual,
} from "../assert";
import {
  captureStill,
  createHarness,
  openSelect,
  openTitle,
  pressAction,
  type Harness,
} from "../harness";

/** The campaign challenge entered, and the row the Extras must still land on. */
const CAMPAIGN_INDEX = 3;
const FIRST_ROW = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lands the Extras on row 1 after a campaign challenge has been entered", async () => {
  await openTitle(h);
  const fresh = await h.snapshot();
  assertGreaterThanOrEqual(
    fresh.campaign.count,
    CAMPAIGN_INDEX + 1,
    "the course holds at least CAMPAIGN_MIN (8) challenges, so challenge 4 is one " +
      "of them and can be entered",
  );
  assertEqual(
    fresh.extras.last,
    FIRST_ROW,
    "a reset leaves both select screens landing on their first row, which is the " +
      "state this point starts from",
  );

  await h.debug.setUnlockedCount(CAMPAIGN_INDEX + 1);
  await openSelect(h, "campaign");
  await h.debug.setSelectIndex(CAMPAIGN_INDEX);
  await pressAction(h, "confirm");
  const entered = await h.snapshot();
  assertEqual(
    entered.screen,
    "editor",
    "confirm on an unlocked challenge opens it in the editor, which is entering it",
  );
  assertEqual(
    entered.challenge?.source,
    "campaign",
    "the challenge entered is the campaign's own",
  );
  assertEqual(
    entered.challenge?.index,
    CAMPAIGN_INDEX,
    "and it is challenge 4 of the course",
  );

  await pressAction(h, "back");
  assertEqual(
    (await h.snapshot()).screen,
    "select",
    "back while editing returns to the select screen the challenge was opened from",
  );
  await pressAction(h, "back");
  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "back on the select screen returns to the title",
  );

  await openSelect(h, "extras");
  await captureStill(h, "first-row");

  const arrived = await h.snapshot();
  assertEqual(
    arrived.mode,
    "extras",
    "the screen arrived at is the Extras', which is the shelf this point reads",
  );
  assertDeepEqual(
    arrived.extras.solved,
    [],
    "no Extras challenge has been solved, so nothing but an entering could move " +
      "where the shelf lands",
  );
  assertEqual(
    arrived.campaign.last,
    CAMPAIGN_INDEX,
    "the campaign kept the row of the challenge that was entered, so the entering " +
      "was recorded somewhere and the Extras' figure is not simply unimplemented",
  );
  assertEqual(
    arrived.extras.last,
    FIRST_ROW,
    "the Extras keep their own resting row, which no campaign entering touches",
  );
  assertEqual(
    arrived.selectIndex,
    FIRST_ROW,
    "arriving at the Extras with no Extras challenge ever entered puts the " +
      "highlight on row 1",
  );
});
