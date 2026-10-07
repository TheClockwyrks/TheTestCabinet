// instrumentation/set-solved-removes — `setSolved(mode, index, false)` unmarks a
// solved challenge.
//
// THE RULE. "`setSolved(mode, index, solved)` — Adds `index` to that mode's
// solved set when `solved` is `true`, and removes it when `false`"
// (`specs/instrumentation.md`, Navigation and progress). This item is the second
// half of that sentence. The snapshot carries the set as `<mode>.solved`,
// "ascending indices", so an index removed is an index the list no longer holds.
//
// A ROW WHOSE INDEX IS OUT OF THE SET IS NOT SOLVED (`specs/modes/campaign.md`):
// "unlocked — Reached and not yet solved", "solved — Completed at least once".
// The select screen is this item's EVIDENCE; the verdict is the set the snapshot
// reports, which is what the row is drawn from.
//
// THE CONFIGURATION. A reset session with no challenge open, no machine and no
// run. Two indices are marked in the Extras and one of them is then unmarked, so
// what is read back tells "removed the index named" apart from "emptied the set".
// A campaign index is marked and left alone, so a removal reaching the other
// mode's set is caught.
//
// THE VERDICT. The unmarked index is gone from that mode's solved set, the index
// marked beside it is still there, and the other mode's set is untouched.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
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

it("removes the unmarked index from that mode's solved set alone", async () => {
  await openTitle(h);
  await h.debug.setSolved("extras", 1, true);
  await h.debug.setSolved("extras", 4, true);
  await h.debug.setSolved("campaign", 1, true);
  const marked = await h.snapshot();
  assertDeepEqual(
    marked.extras.solved,
    [1, 4],
    "both marks landed, so there is something to remove",
  );
  assertDeepEqual(
    marked.campaign.solved,
    [1],
    "and the campaign carries a mark of its own at the same index",
  );

  await h.debug.setSolved("extras", 1, false);
  await openSelect(h, "extras");
  await captureStill(h, "unsolved");
  const unmarked = await h.snapshot();
  assertDeepEqual(
    unmarked.extras.solved,
    [4],
    "setSolved(extras, 1, false) removes 1 and leaves 4 marked",
  );
  assertDeepEqual(
    unmarked.campaign.solved,
    [1],
    "the removal landed in the mode it named and left the other mode's set alone",
  );
});
