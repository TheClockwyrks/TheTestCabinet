// screens/how-to-play-back — BACK on the how-to screen returns to the title.
//
// `specs/ui.md` lists the how-to screen's menu as `HOW_TO_PLAY_ITEMS`: `BACK`,
// and its transition table states `how-to-play` | `BACK`, or the `pause` action |
// `title`. This point decides the `BACK` route: the item is highlighted and
// confirmed with `activate`, and the screen that follows must be `title`.
//
// ONE ROUTE PER POINT. The `pause` route out of the same screen is
// `screens/how-to-play-pause-returns`, so a build that wired one and not the
// other grades differently from a build that wired both. Nothing here falls back
// to the other key: a `BACK` item that does nothing fails this point.
//
// WHICH ENTRY THE TITLE ARRIVES ON is `screens/returns-to-the-title-on-how-to-play`,
// so this one reads the screen alone.
//
// GETTING THERE IS ITS OWN POINT. `screens/how-to-play-reachable` decides that
// `HOW TO PLAY` on the title reaches the screen, so this one poses the screen
// directly through the surface: a build with a broken title menu and a working
// back must pass this and fail that one.
//
// ISOLATION. The how-to screen posed on a cleared slot, with nothing about an
// expedition touched.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOW_TO_PLAY_ITEMS } from "../constants";
import {
  ACTION_KEY,
  captureStill,
  createHarness,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title when BACK is confirmed", async () => {
  await h.debug.setAutoStep(false);
  await h.debug.clearSave();
  await h.debug.reset();
  await h.debug.setScreen("how-to-play");
  await h.debug.setMenuIndex(HOW_TO_PLAY_ITEMS.indexOf("BACK"));

  await h.tap(ACTION_KEY.activate);
  await captureStill(h, "back");

  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "specs/ui.md: BACK on the how-to-play screen returns to the title",
  );
});
