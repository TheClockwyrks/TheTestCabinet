// Refract — campaign/select-locked-refused: confirm on a locked board does
// nothing.
//
// On a fresh campaign only board 1 is unlocked, so one right puts the
// highlight on board 2, a locked board. The confirm that follows must change
// nothing: still on select, the highlight exactly where it was
// (specs/modes/campaign.md "confirm on a locked board does nothing and leaves
// the highlight where it is").

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
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

it("confirm on a locked board changes neither the screen nor the highlight", async () => {
  await resetTo(h);
  await startCampaign(h);
  assertEqual(
    h.snapshot().unlockedCount,
    1,
    "a fresh course: board 2 is still locked (specs/modes/campaign.md)",
  );

  await tapAction(h, "right");
  assertEqual(
    h.snapshot().selectIndex,
    1,
    "the highlight moved onto board 2, the locked board",
  );

  await tapAction(h, "confirm");
  captureStill(h, "locked");

  const refused = h.snapshot();
  assertEqual(
    refused.screen,
    "select",
    "confirm on a locked board does nothing: still on select " +
      "(specs/modes/campaign.md)",
  );
  assertEqual(
    refused.selectIndex,
    1,
    "the highlight stays where it is (specs/modes/campaign.md)",
  );
});
