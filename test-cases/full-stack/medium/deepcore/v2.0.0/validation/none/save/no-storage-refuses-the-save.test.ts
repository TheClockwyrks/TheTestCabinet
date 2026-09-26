// save/no-storage-refuses-the-save — with nowhere to save, the game says so.
//
// specs/expedition.md: the game runs "simply without saving" when the browser
// storage is unavailable. Two readings of that, and they are one behavior: there
// is no save, so the title carries no `CONTINUE`, and activating the Save Pad
// leaves `hasSave` false rather than claiming a save that was never written.
//
// THAT THE GAME RUNS AT ALL IS ITS OWN POINT. `save/runs-without-storage` decides
// that the build stands up, draws and plays with no storage behind it.
//
// HOW THE STORAGE IS TAKEN AWAY is `save/no-storage`, which shuts every door the
// same way a browser shuts them.
//
// ISOLATION. One expedition posed at the Save Pad, with nothing driven but the
// activation the refusal is about.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS, TITLE_ITEMS_NO_SAVE } from "../constants";
import {
  ACTION_KEY,
  captureStill,
  createHarness,
  openScene,
  standAtBuilding,
  type Harness,
} from "../harness";
import { drewText } from "../case-harness/index";
import { menuLength } from "./expedition";
import { withoutStorage } from "./no-storage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("offers no CONTINUE and takes no save at the Save Pad", async () => {
  await withoutStorage(h);
  await openScene(h, { screen: "title" });

  assertEqual(
    (await h.snapshot()).hasSave,
    false,
    "specs/expedition.md: there is no save while the storage is unavailable",
  );
  const title = await h.frameCalls();
  assertEqual(
    drewText(title, TITLE_ITEMS[0]),
    false,
    "specs/ui.md: the title carries no CONTINUE with no save to continue",
  );
  assertEqual(
    await menuLength(h),
    TITLE_ITEMS_NO_SAVE.length,
    "specs/ui.md: the title menu is NEW EXPEDITION and HOW TO PLAY",
  );

  await openScene(h);
  await standAtBuilding(h, "save-pad");
  await h.advance(1);
  await h.tap(ACTION_KEY.activate);
  await captureStill(h, "refused");

  const after = await h.snapshot();
  assertEqual(
    after.hasSave,
    false,
    "specs/expedition.md: the game runs simply without saving",
  );
  assertEqual(
    after.screen,
    "in-mine",
    "specs/expedition.md: the refused save leaves the game running in the mine",
  );
});
