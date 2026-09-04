// instrumentation/set-solved-adds — `setSolved(mode, index, true)` marks a
// challenge solved.
//
// THE RULE. "`setSolved(mode, index, solved)` — Adds `index` to that mode's
// solved set when `solved` is `true`, and removes it when `false`"
// (`specs/instrumentation.md`, Navigation and progress). The snapshot carries
// each mode's set as `campaign.solved` and `extras.solved`, "ascending indices",
// and `reset` leaves both empty: "all progress cleared, so nothing is solved".
// `mode` "is `"campaign"` or `"extras"` throughout this group", so the two sets
// are separate and a mark lands in the one named.
//
// A SOLVED CHALLENGE IS WHAT THE SELECT SCREEN READS OFF THAT SET
// (`specs/modes/campaign.md`): "solved — Completed at least once. Can be entered
// again", with the state "readable without relying on hue alone". The screen's
// drawing is this item's EVIDENCE; the verdict is the set the snapshot reports,
// which is what the row is drawn from.
//
// THE CONFIGURATION. A reset session with no challenge open, no machine and no
// run: `setSolved` is the only thing that touches progress here. One index is
// marked in each mode, and the two are different indices so a build that wrote
// into the wrong mode's set is caught by the other set rather than hidden by it.
//
// THE VERDICT. `extras.solved` reports exactly the extras index marked and
// `campaign.solved` exactly the campaign one, each mark landing in its own mode's
// set and nowhere else.

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

it("adds the marked index to that mode's solved set alone", async () => {
  await openTitle(h);
  const fresh = await h.snapshot();
  assertDeepEqual(
    fresh.campaign.solved,
    [],
    "a reset clears all progress, so nothing is solved in the campaign",
  );
  assertDeepEqual(
    fresh.extras.solved,
    [],
    "a reset clears all progress, so nothing is solved in the Extras",
  );

  await h.debug.setSolved("extras", 3, true);
  const marked = await h.snapshot();
  assertDeepEqual(
    marked.extras.solved,
    [3],
    "setSolved(extras, 3, true) adds 3 to the Extras' solved set",
  );
  assertDeepEqual(
    marked.campaign.solved,
    [],
    "the mark landed in the mode it named and left the other mode's set empty",
  );

  await h.debug.setSolved("campaign", 5, true);
  await openSelect(h, "extras");
  await captureStill(h, "solved");
  const both = await h.snapshot();
  assertDeepEqual(
    both.campaign.solved,
    [5],
    "setSolved(campaign, 5, true) adds 5 to the campaign's solved set",
  );
  assertDeepEqual(
    both.extras.solved,
    [3],
    "and leaves the Extras' set holding the index marked there",
  );
});
