// screens/title-visit-keeps-records — a visit to the title throws no record away.
//
// THE RULE, `specs/ui.md`, Screens, `title`: "Reaching `title` discards nothing:
// progress, records, and the per-challenge machines of `specs/editor.md` are
// unchanged by the visit." The records are the three figures
// `specs/modes/campaign.md` keeps per challenge — "the lowest `cost`, the lowest
// `cycles`, and the lowest `area` over the session's completed runs of it, each
// metric independently" — reported per mode as "`records`: [{ cost, cycles, area
// } | null], // one entry per challenge" (`specs/instrumentation.md`). The
// unlocking and the solving are `title-visit-keeps-unlocks-and-solved`'s point
// and the stashed machines `title-visit-keeps-stashed-machines`'s.
//
// THE CONFIGURATION poses records that a discard would visibly undo, through the
// surface's own `setRecord`, which "Sets one record of one challenge ... A
// challenge with no record yet gains one whose other two metrics are `0`." All
// three metrics are set on one campaign challenge, one metric on a second, and
// one on an Extras challenge, so a build that kept one mode's records and dropped
// the other's, or that kept only the challenge it was last in, is caught. The
// posed values are read back BEFORE the visit and the whole `records` list is
// compared against that reading afterwards, so a build that reports no record at
// all cannot pass by having two absent readings agree.
//
// BOTH ROUTES THE ITEM NAMES ARE WALKED. The title is reached once from the
// EDITOR, over an open challenge, and once from a SELECT screen. `setScreen`
// "Enters the screen `name` ... exactly as the real transition into it enters
// it", and leaving the editor through it "leaves it exactly as leaving it in play
// does" (`specs/instrumentation.md`); neither `openChallenge` nor the visit may
// touch the records, since "Neither operation touches progress: the unlocked
// count, the solved sets, the records, the per-challenge stashes, and both `last`
// figures stand as they are."
//
// THE VERDICT. After each arrival at the title, both modes' whole `records` lists
// are exactly what they were before the visit, and the challenge whose three
// metrics were posed still carries all three.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThanOrEqual,
  assertNotNull,
} from "../assert";
import {
  captureReplay,
  createHarness,
  openChallenge,
  openTitle,
  type Harness,
} from "../harness";

/** The campaign row whose three metrics are all posed. */
const FULL_ROW = 0;

/** A second campaign row, carrying one metric alone. */
const PART_ROW = 2;

/** The Extras row carrying one metric. */
const EXTRA_ROW = 5;

/** The three figures posed on {@link FULL_ROW}. */
const COST = 12;
const CYCLES = 7;
const AREA = 9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries every challenge's records through a visit to the title", async () => {
  await openTitle(h);
  const fresh = await h.snapshot();
  assertGreaterThanOrEqual(
    fresh.campaign.count,
    PART_ROW + 1,
    "the shipped course is long enough to hold the rows this point poses records on",
  );
  assertGreaterThanOrEqual(
    fresh.extras.count,
    EXTRA_ROW + 1,
    "the Extras shelf is long enough to hold the row this point poses a record on",
  );

  await h.debug.setRecord("campaign", FULL_ROW, "cost", COST);
  await h.debug.setRecord("campaign", FULL_ROW, "cycles", CYCLES);
  await h.debug.setRecord("campaign", FULL_ROW, "area", AREA);
  await h.debug.setRecord("campaign", PART_ROW, "cycles", CYCLES);
  await h.debug.setRecord("extras", EXTRA_ROW, "area", AREA);
  await h.advance(1);

  const posed = await h.snapshot();
  const full = posed.campaign.records[FULL_ROW] ?? null;
  assertNotNull(
    full,
    `campaign challenge ${FULL_ROW + 1} carries a record before the visit`,
  );
  assertEqual(full?.cost, COST, "the posed cost is there before the visit");
  assertEqual(full?.cycles, CYCLES, "the posed cycles are there before the visit");
  assertEqual(full?.area, AREA, "the posed area is there before the visit");
  assertNotNull(
    posed.campaign.records[PART_ROW] ?? null,
    `campaign challenge ${PART_ROW + 1} carries a record before the visit`,
  );
  assertNotNull(
    posed.extras.records[EXTRA_ROW] ?? null,
    `Extras challenge ${EXTRA_ROW + 1} carries a record before the visit`,
  );
  const campaignRecords = posed.campaign.records;
  const extrasRecords = posed.extras.records;

  // The first route: out of the editor, over an open challenge.
  const fromEditor = await captureReplay(h, "records-kept", async () => {
    await openChallenge(h, "campaign", FULL_ROW);
    await h.debug.setScreen("title");
    await h.advance(1);
    return h.snapshot();
  });
  assertEqual(
    fromEditor.screen,
    "title",
    "the first visit really reached the title, out of the editor",
  );
  assertDeepEqual(
    fromEditor.campaign.records,
    campaignRecords,
    "reaching the title from the editor leaves every campaign record as it stood",
  );
  assertDeepEqual(
    fromEditor.extras.records,
    extrasRecords,
    "reaching the title from the editor leaves every Extras record as it stood",
  );

  // The second route: out of a select screen.
  await h.debug.setScreen("select");
  await h.advance(1);
  await h.debug.setScreen("title");
  await h.advance(1);

  const fromSelect = await h.snapshot();
  assertEqual(
    fromSelect.screen,
    "title",
    "the second visit really reached the title, out of a select screen",
  );
  assertDeepEqual(
    fromSelect.campaign.records,
    campaignRecords,
    "reaching the title from a select screen leaves every campaign record as it stood",
  );
  assertDeepEqual(
    fromSelect.extras.records,
    extrasRecords,
    "reaching the title from a select screen leaves every Extras record as it stood",
  );
});
