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
import { TITLE_ITEMS, TITLE_ITEMS_NO_SAVE } from "../constants";
import { assertEqual } from "../assert";
import {
  ACTION_KEY,
  captureStill,
  createHarness,
  drewText,
  type Harness,
  openScene,
  standAtBuilding,
} from "../harness";
import { menuLength } from "./expedition";
import { denyStorage, ran, restoreStorage } from "./no-storage";

let h: Harness | undefined;

beforeEach(() => {
  denyStorage();
});

afterEach(() => {
  h?.dispose();
  h = undefined;
  restoreStorage();
});

it("offers no CONTINUE and takes no save at the Save Pad", async () => {
  h = await ran("standing the game up", () => createHarness());
  const game = h;

  openScene(game, { screen: "title" });
  assertEqual(
    game.snapshot().hasSave,
    false,
    "specs/expedition.md: there is no save while the storage is unavailable",
  );
  const title = await game.frameCalls();
  assertEqual(
    drewText(title, TITLE_ITEMS[0]),
    false,
    "specs/ui.md: the title carries no CONTINUE with no save to continue",
  );
  assertEqual(
    await ran("stepping the title menu", () => menuLength(game)),
    TITLE_ITEMS_NO_SAVE.length,
    "specs/ui.md: the title menu is NEW EXPEDITION and HOW TO PLAY",
  );

  openScene(game);
  standAtBuilding(game, "save-pad");
  await game.advance(1);
  await ran("activating the Save Pad", () => game.tap(ACTION_KEY.activate));
  captureStill(game, "refused");

  const after = game.snapshot();
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
