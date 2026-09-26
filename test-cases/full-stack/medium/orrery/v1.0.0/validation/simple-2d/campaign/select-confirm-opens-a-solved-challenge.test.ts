// campaign/select-confirm-opens-a-solved-challenge — a solved row can be taken
// again, and taking it spends nothing.
//
// THE RULE. The select screen's state table gives solved as "Completed at least
// once. Can be entered again", and the keys say "`confirm` on an unlocked or
// solved challenge opens it in the editor" (`specs/modes/campaign.md`, The select
// screen). Progression says the same from the other side: "Completing a challenge
// again is a replay. Each challenge keeps its records" — so re-entering a solved
// challenge neither clears its mark nor spends its records. This point decides the
// SOLVED row's `confirm`; the locked row's refusal is its own item, and so is what
// a replay does to a record once one is run.
//
// THE WORLD IS POSED WHOLE, THROUGH THE OPERATIONS WRITTEN FOR IT.
// `setSolved(mode, index, solved)` "Adds `index` to that mode's solved set", and
// `setRecord(mode, index, metric, value)` "Sets one record of one challenge"
// (`specs/instrumentation.md`). Challenge 2 is marked solved and given all three
// records, and `setUnlockedCount(2)` opens its row, which is the state a session
// that had completed challenge 1 and then challenge 2 would stand in. The three
// record figures are distinct from each other and from every row number on the
// screen, so a record that came back changed is reported as the figure it changed
// to rather than mistaken for another.
//
// THE PRESS IS THE PLAYER'S: "Menus and select lists are worked from the keyboard
// alone, through the registered actions of `specs/controls.md`" (`specs/ui.md`).
//
// THE VERDICT. The editor is showing the course's own challenge at that row, and
// the solved set and all three of its records stand exactly as they were posed.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertNotNull,
} from "../assert";
import { METRICS } from "../constants";
import {
  captureStill,
  createHarness,
  openSelect,
  pressAction,
  type Harness,
} from "../harness";

/** The solved row: challenge 2, so the row taken is not a fresh session's landing. */
const SOLVED_ROW = 1;

/**
 * The records posed on that challenge, one distinct figure per metric.
 *
 * None of them is a challenge number of a course of at most `CAMPAIGN_MAX` (`16`)
 * challenges, and no two are equal, so each metric is read back as itself.
 */
const RECORDS: Record<string, number> = { cost: 41, cycles: 52, area: 63 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens a solved challenge from its row with its mark and records untouched", async () => {
  await h.debug.reset();
  assertGreaterThan(
    (await h.snapshot()).campaign.count,
    SOLVED_ROW,
    `the course holds a challenge ${SOLVED_ROW + 1}, which is the solved row`,
  );
  await h.debug.setUnlockedCount(SOLVED_ROW + 1);
  await h.debug.setSolved("campaign", SOLVED_ROW, true);
  for (const metric of METRICS) {
    await h.debug.setRecord(
      "campaign",
      SOLVED_ROW,
      metric,
      RECORDS[metric] as number,
    );
  }
  const posed = await h.snapshot();
  assertDeepEqual(
    posed.campaign.solved,
    [SOLVED_ROW],
    "the world this point decides in has challenge 2 solved and nothing else",
  );

  await openSelect(h, "campaign");
  await h.debug.setSelectIndex(SOLVED_ROW);
  await h.advance(1);

  await pressAction(h, "confirm");
  await captureStill(h, "reopened");

  const opened = await h.snapshot();
  assertEqual(
    opened.screen,
    "editor",
    "confirm on a solved challenge opens it in the editor, so a challenge " +
      "completed once can be entered again",
  );
  assertNotNull(
    opened.challenge,
    "the challenge taken from the solved row is the one open in the editor",
  );
  assertEqual(
    opened.challenge?.source,
    "campaign",
    "the challenge opened is the course's own, not a document",
  );
  assertEqual(
    opened.challenge?.index,
    SOLVED_ROW,
    "the challenge opened is the one whose row was taken",
  );
  assertDeepEqual(
    opened.campaign.solved,
    [SOLVED_ROW],
    "entering a solved challenge again leaves its solved mark standing",
  );
  const record = opened.campaign.records[SOLVED_ROW] ?? null;
  assertNotNull(
    record,
    "the challenge's records entry is still there after its row was taken again",
  );
  for (const metric of METRICS) {
    assertEqual(
      record?.[metric],
      RECORDS[metric],
      `entering a solved challenge again leaves its ${metric} record untouched`,
    );
  }
});
