// Refract — campaign/select-locked-refused: confirm on a locked board does
// nothing.
//
// specs/modes/campaign.md: "confirm on a locked board does nothing and leaves
// the highlight where it is." On a fresh course every board but board 1 is
// locked, so one step right puts the highlight on board 2, locked, and the
// confirm that follows must change neither the screen nor `selectIndex`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  fireAction,
  startCampaign,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the screen and the highlight unchanged", async () => {
  await startCampaign(h);
  await fireAction(h, "right");
  const before = await h.snapshot();
  assertEqual(before.unlockedCount, 1, "board 2 is locked on a fresh course");
  assertEqual(before.selectIndex, 1, "the highlight sits on board 2");

  await fireAction(h, "confirm");
  await captureStill(h, "locked");

  const after = await h.snapshot();
  assertEqual(
    after.screen,
    "select",
    "confirm on a locked board changes no screen",
  );
  assertEqual(after.selectIndex, 1, "the highlight stays where it is");
});
