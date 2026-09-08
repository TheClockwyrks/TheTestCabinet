// instrumentation/challenge-ops-leave-progress-alone — opening a challenge touches
// no progress.
//
// THE RULE. "Neither operation touches progress: the unlocked count, the solved
// sets, the records, the per-challenge stashes, and both `last` figures stand as
// they are" (`specs/instrumentation.md`, The challenge), said of `openChallenge`
// and `loadChallenge` together. It is the group's own rule restated: "Each pose
// sets one thing and leaves the rest of the game as it stands."
//
// WHAT PROGRESS IS is the snapshot's two mode records: `unlockedCount`, `solved`,
// `records`, `stashed` — "the challenges each mode holds a stashed machine for" —
// and `last`. Comparing the whole of each record before and against after is the
// reading, because the rule names all five.
//
// THE CONFIGURATION. Progress posed to a state no default could be mistaken for:
// an unlocked count off its resting `1`, a solved index in each mode, a record on
// one challenge, a `last` in each mode away from `0`, and a real STASH — an Extras
// challenge entered, a part placed, and the editor left by `setScreen`, which
// "leaves it exactly as leaving it in play does: ... the open challenge's machine
// is stashed". Every one of the five is read back before the openings, so the
// comparison afterwards is against something rather than against nothing. Then
// `openChallenge` is called on a challenge in each mode and `loadChallenge` on a
// document of this project's own, and the whole record is compared again after
// each.
//
// THE VERDICT. Both modes' unlocked count, solved set, records, stashes and
// `last` stand unchanged across all three openings.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { at } from "../field";
import { REPEATING } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallenge,
  openSelect,
  openTitle,
  placePart,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves every figure of both modes' progress standing across the openings", async () => {
  await openTitle(h);

  // A stash: a machine on an Extras challenge, left behind by leaving the editor.
  await openChallenge(h, "extras", 2);
  await placePart(h, "arm", at(0, 0), 0);
  await h.debug.setScreen("select");

  await h.debug.setUnlockedCount(4);
  await h.debug.setSolved("campaign", 1, true);
  await h.debug.setSolved("extras", 5, true);
  await h.debug.setRecord("extras", 5, "cycles", 63);
  await h.debug.setLast("campaign", 2);
  await h.debug.setLast("extras", 7);
  await openSelect(h, "extras");
  await captureStill(h, "progress");

  const before = await h.snapshot();
  assertEqual(before.campaign.unlockedCount, 4, "the unlocked count is posed");
  assertDeepEqual(before.campaign.solved, [1], "the campaign's set is posed");
  assertDeepEqual(before.extras.solved, [5], "the Extras' set is posed");
  assertNotNull(
    before.extras.records[5] ?? null,
    "a record is posed on one Extras challenge",
  );
  assertDeepEqual(
    before.extras.stashed,
    [2],
    "and a machine is stashed for the Extras challenge that was left",
  );
  assertEqual(before.campaign.last, 2, "the campaign's last row is posed");
  assertEqual(before.extras.last, 7, "the Extras' last row is posed");

  await openChallenge(h, "extras", 8);
  const afterExtras = await h.snapshot();
  assertDeepEqual(
    afterExtras.campaign,
    before.campaign,
    "openChallenge on an Extra leaves the campaign's progress alone",
  );
  assertDeepEqual(
    afterExtras.extras,
    before.extras,
    "and the Extras' own progress alone",
  );

  await openChallenge(h, "campaign", 6);
  const afterCampaign = await h.snapshot();
  assertDeepEqual(
    afterCampaign.campaign,
    before.campaign,
    "openChallenge on a campaign row leaves the campaign's progress alone",
  );
  assertDeepEqual(
    afterCampaign.extras,
    before.extras,
    "and the Extras' progress alone",
  );

  await h.debug.loadChallenge(REPEATING);
  const afterLoad = await h.snapshot();
  assertDeepEqual(
    afterLoad.campaign,
    before.campaign,
    "loadChallenge leaves the campaign's progress alone",
  );
  assertDeepEqual(
    afterLoad.extras,
    before.extras,
    "and the Extras' progress alone",
  );
});
