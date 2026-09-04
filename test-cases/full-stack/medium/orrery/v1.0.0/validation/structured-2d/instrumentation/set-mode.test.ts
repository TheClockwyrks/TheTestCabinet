// instrumentation/set-mode — `setMode` chooses which course the select and editor
// screens serve.
//
// THE RULE. `specs/instrumentation.md`, Navigation and progress: "`setMode(mode)`
// | Sets the course the select and editor screens serve", with "`mode` is
// `"campaign"` or `"extras"` throughout this group". The snapshot reports it as
// "mode: "campaign" | "extras"", and `specs/ui.md` says what it decides:
// "`state.mode` is `campaign` or `extras`, and decides which course the `select`
// and `editor` screens serve."
//
// THE CONFIGURATION. A reset session, taken to the select screen in each mode in
// turn and then INTO a challenge from that screen with `confirm`, because the rule
// is about the course the two screens serve rather than about a field. The row
// entered is `0` in both modes: challenge `1` is the one the campaign has unlocked
// from the start (`specs/modes/campaign.md`) and every Extras row is open
// (`specs/modes/extras.md`), so the same row can be entered in both and the only
// thing that differs is which course it came out of.
//
// WHAT SAYS WHICH COURSE OPENED. The challenge's own `source` and `index`, which
// `specs/instrumentation.md` fixes for a shipped challenge: "The snapshot reports
// it under that `mode` and `index`." The two courses are different lists, so the
// name that opens differs as well, and the check reads that the two names are not
// the same.
//
// THE VERDICT. In each mode the snapshot reports the mode set, the select screen
// serves that mode, and the challenge that opens from it belongs to that mode's
// course.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual, assertNotNull } from "../assert";
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

it("serves the campaign or the Extras, as the mode is set", async () => {
  await openTitle(h);

  await h.debug.setMode("campaign");
  assertEqual(
    (await h.snapshot()).mode,
    "campaign",
    "the snapshot reports the mode set",
  );
  await h.debug.setScreen("select");
  await h.advance(1);
  await captureStill(h, "mode");
  await h.debug.setSelectIndex(0);
  await pressAction(h, "confirm");

  const campaign = await h.snapshot();
  assertEqual(
    campaign.screen,
    "editor",
    "confirm on the row opened a challenge",
  );
  assertNotNull(campaign.challenge, "a challenge is open");
  assertEqual(
    campaign.challenge?.source,
    "campaign",
    "the editor opened the campaign's challenge, because that is the mode set",
  );
  assertEqual(
    campaign.challenge?.index,
    0,
    "it opened the row that was highlighted",
  );
  assertEqual(campaign.mode, "campaign", "the mode still reports campaign");

  await openTitle(h);
  await h.debug.setMode("extras");
  assertEqual(
    (await h.snapshot()).mode,
    "extras",
    "the snapshot reports the mode set",
  );
  await openSelect(h, "extras");
  await h.debug.setSelectIndex(0);
  await pressAction(h, "confirm");

  const extras = await h.snapshot();
  assertEqual(extras.screen, "editor", "confirm on the row opened a challenge");
  assertEqual(
    extras.challenge?.source,
    "extras",
    "the editor opened the Extras' challenge, because that is the mode set",
  );
  assertEqual(
    extras.challenge?.index,
    0,
    "it opened the row that was highlighted",
  );
  assertEqual(extras.mode, "extras", "the mode still reports extras");
  assertNotEqual(
    extras.challenge?.name,
    campaign.challenge?.name,
    "the two modes are different courses, so the same row opens a different challenge",
  );
});
