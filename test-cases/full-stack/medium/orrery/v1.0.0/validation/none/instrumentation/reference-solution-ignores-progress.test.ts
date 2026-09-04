// instrumentation/reference-solution-ignores-progress — a reference solution is
// reachable whatever is unlocked.
//
// THE RULE. "`referenceSolution(mode, index)` — A pure read: the build's own
// reference solution for that challenge, as a solution document, whatever is
// unlocked or solved" (`specs/instrumentation.md`, The challenge). A pure read
// changes nothing: "a reading returns what it read and changes nothing".
//
// WHAT IS BEING READ. `specs/modes/campaign.md` requires one per challenge — "the
// build ships a reference solution for it, in the solution format, that is legal,
// places every rise and set, and whose run completes without faulting" — and
// `specs/modes/extras.md` requires the same of every Extra. "This is where they
// are reachable", so the read is the only route to them and it may not depend on
// how far a session has got.
//
// THE CONFIGURATION. One campaign challenge, read three times in one session,
// with the progress around it moved between the reads and nothing else touched:
// first LOCKED, with the unlocked count at `1` so every row but the first is shut;
// then UNLOCKED, with the count raised past it; then SOLVED, with its index in the
// campaign's solved set. The whole of both modes' progress is read immediately
// before and after the first read, so "reading one unlocks and solves nothing" is
// decided on the reading itself rather than on what the poses afterwards did.
//
// THE VERDICT. The three reads answer the same document, and it is a real one —
// a machine with parts in it, as the course requires. The read against the locked
// row left the unlocked count, both solved sets, every record, every stash and
// both `last` figures exactly as they stood.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
} from "../assert";
import {
  captureStill,
  createHarness,
  openSelect,
  openTitle,
  referenceSolution,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("answers the same document locked, unlocked and solved, and changes no progress", async () => {
  await openTitle(h);
  await h.debug.setUnlockedCount(1);
  const course = (await h.snapshot()).campaign.count;
  const index = course - 1;
  assertGreaterThan(index, 0, "the last row of the course is not the first");

  await openSelect(h, "campaign");
  await captureStill(h, "locked");

  const before = await h.snapshot();
  assertEqual(
    before.campaign.unlockedCount,
    1,
    "only the first campaign challenge is open, so this row is locked",
  );
  assertDeepEqual(
    before.campaign.solved,
    [],
    "and nothing is solved, so this row is not solved either",
  );

  const whileLocked = await referenceSolution(h, "campaign", index);
  const after = await h.snapshot();
  assertDeepEqual(
    after.campaign,
    before.campaign,
    "reading a reference solution unlocks nothing and solves nothing",
  );
  assertDeepEqual(
    after.extras,
    before.extras,
    "and touches the other mode's progress no more than its own",
  );
  assertGreaterThan(
    whileLocked.parts.length,
    0,
    "a reference solution places every rise and set, so it is a machine rather than an empty document",
  );

  await h.debug.setUnlockedCount(course);
  const whileUnlocked = await referenceSolution(h, "campaign", index);
  assertDeepEqual(
    whileUnlocked,
    whileLocked,
    "unlocking the row answers the same document",
  );

  await h.debug.setSolved("campaign", index, true);
  const whileSolved = await referenceSolution(h, "campaign", index);
  assertDeepEqual(
    whileSolved,
    whileLocked,
    "and solving it answers the same document again",
  );
});
