// Refract — campaign/select-locked-refused: confirm on a locked board does
// nothing.
//
// On a fresh course only board 1 is unlocked, so board 2 — one step right — is
// locked, and `confirm` there must change nothing: the screen stays `select`
// and `selectIndex` stays where it was, the highlight left where it is
// (specs/modes/campaign.md: confirm on a locked board does nothing and leaves
// the highlight where it is).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startCampaign,
  tapAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the screen and the highlight unchanged", async () => {
  await startCampaign(h);
  assertEqual(
    h.snapshot().unlockedCount,
    1,
    "board 2 is locked on a fresh course",
  );
  await tapAction(h, "right");
  assertEqual(h.snapshot().selectIndex, 1, "the highlight sits on board 2");

  await tapAction(h, "confirm");
  await h.advance(1);
  captureStill(h, "locked");

  const after = h.snapshot();
  assertEqual(after.screen, "select", "the refused confirm changes no screen");
  assertEqual(
    after.selectIndex,
    1,
    "the refused confirm leaves the highlight where it is",
  );
});
