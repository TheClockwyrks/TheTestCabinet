// instrumentation/reset-clears-progress — reset throws away everything the session
// earned, in both modes.
//
// THE RULE. "`reset()` — Restores every declared field of the game's state to its
// title-screen value: ... and all progress cleared, so nothing is solved, every
// record and stash is empty, only the first campaign challenge is unlocked, and both
// select screens land on their first row" (`specs/instrumentation.md`, Session), with
// the resting values the same file tabulates: `campaign.unlockedCount` `1`,
// `campaign.stashed` and `extras.stashed` empty, `campaign.last` and `extras.last`
// `0`. `specs/state.md` states what that leaves: "A reset restores the declared
// fields to their title-screen values", "no challenge open, an empty editor, no run,
// nothing solved, and only the first campaign challenge unlocked."
//
// THE POSE IS A SESSION THAT HAS PLAYED BOTH MODES, and it is built out of the
// operations the specification gives for each part of progress: `setSolved` for the
// solved sets, `setRecord` for the records, `setUnlockedCount` for the course, and
// `setLast` for the row each select screen lands on. The STASHES have no operation
// of their own, and are made the way the game makes them:
// "A call to `setScreen` that leaves the editor leaves it exactly as leaving it in
// play does: a live run is stopped, the open challenge's machine is stashed as
// `specs/editor.md` states" — so a challenge is opened in each mode, given a part,
// and left.
//
// EVERY POSED FIGURE IS READ BACK BEFORE THE RESET, in both modes, so nothing below
// can pass by having never been earned. And after it, every record entry of both
// modes is read, rather than a sample: "every record ... is empty" is a claim about
// the whole array.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { EXTRA_COUNT, METRICS, MODES } from "../constants";
import { ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  openSelect,
  progressOf,
  type Harness,
} from "../harness";

/** The challenge of each mode the pose solves, records, stashes and lands on. */
const TOUCHED = 1;

/** The figures the pose writes into each touched challenge's record. */
const POSED_RECORD = { cost: 40, cycles: 12, area: 9 };

/** How many campaign challenges the pose opens. */
const POSED_UNLOCKED = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("empties the solved sets, the records, the stashes, both landings and the course", async () => {
  await h.debug.reset();
  const fresh = await h.snapshot();
  assertGreaterThan(
    fresh.campaign.count,
    POSED_UNLOCKED,
    "the course is long enough for the pose to open several of it",
  );
  assertEqual(
    fresh.extras.count,
    EXTRA_COUNT,
    "and the Extras shelf holds EXTRA_COUNT challenges",
  );

  // A session that has played both modes.
  await h.debug.setUnlockedCount(POSED_UNLOCKED);
  for (const mode of MODES) {
    await h.debug.setSolved(mode, TOUCHED, true);
    for (const metric of METRICS) {
      await h.debug.setRecord(mode, TOUCHED, metric, POSED_RECORD[metric]);
    }
    await h.debug.setLast(mode, TOUCHED);
    // A stash is what leaving the editor over a machine leaves behind.
    await h.debug.openChallenge(mode, TOUCHED);
    await h.debug.placePart("arm", ORIGIN.q, ORIGIN.r, 0);
    await h.debug.setScreen("select");
  }

  const posed = await h.snapshot();
  for (const mode of MODES) {
    const progress = progressOf(posed, mode);
    assertDeepEqual(
      progress.solved,
      [TOUCHED],
      `${mode} has a solved challenge before the reset`,
    );
    assertDeepEqual(
      progress.records[TOUCHED],
      POSED_RECORD,
      `and a record on it`,
    );
    assertDeepEqual(
      progress.stashed,
      [TOUCHED],
      `and a stashed machine for it`,
    );
    assertEqual(progress.last, TOUCHED, `and lands its select screen on it`);
  }
  assertEqual(
    posed.campaign.unlockedCount,
    POSED_UNLOCKED,
    "and several campaign challenges are open",
  );

  await h.debug.reset();
  const reset = await h.snapshot();
  await openSelect(h, "campaign");
  await captureStill(h, "progress");

  for (const mode of MODES) {
    const progress = progressOf(reset, mode);
    assertLength(progress.solved, 0, `reset leaves nothing solved in ${mode}`);
    assertLength(
      progress.records,
      progress.count,
      `${mode} still reports one record entry per challenge`,
    );
    for (const [index, record] of progress.records.entries()) {
      assertNull(record, `and ${mode} record ${index} is empty`);
    }
    assertLength(progress.stashed, 0, `no ${mode} machine is stashed`);
    assertEqual(
      progress.last,
      0,
      `and the ${mode} select screen lands on its first row`,
    );
  }
  const course = progressOf(reset, "campaign");
  assertNotNull(
    course.unlockedCount,
    "the campaign reports how many of it are open",
  );
  assertEqual(
    course.unlockedCount,
    1,
    "and only the first campaign challenge is open",
  );
});
