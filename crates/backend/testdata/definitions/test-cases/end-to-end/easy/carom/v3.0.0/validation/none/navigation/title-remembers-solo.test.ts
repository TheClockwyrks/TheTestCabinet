// navigation/title-remembers-solo — quitting a Solo match returns to the title on
// SOLO.
//
// specs/ui.md, "The remembered title selection": confirming an item on the title
// menu sets `titleIndex` to that item's index. And "Returning to the title":
// `QUIT TO MENU` restores `menuIndex` from `titleIndex`. The match was started by
// confirming `SOLO`, the first of `TITLE_ITEMS`, so the title it quits back to is
// on `SOLO`.
//
// `titleIndex` IS POSED ONTO `HOW TO PLAY` BEFORE THE CONFIRM, which is the whole
// reason this point can fail. `SOLO` is index `0` and a fresh title already
// remembers `0`, so a build that never writes `titleIndex` at all would read back
// the right figure by accident; posing the entry a player was last on leaves the
// `SOLO` confirm something to overwrite, and the `2` a forgetful build reads back
// is the fault. `setTitleIndex` is the one operation that sets that field
// (specs/instrumentation.md), and it sets nothing else.
//
// Two real keys, and they are the two this point is about: the `Enter` that
// confirms `SOLO` and the `Enter` that confirms `QUIT TO MENU`. Everything between
// them is posed — the pause menu is the three fields specs/ui.md says a `pause`
// edge sets, and the selection is put straight onto the third entry — because the
// key that opens that menu is `controls-solo/escape`'s point and the movement
// edges are the pause menu's own. `navigation/pause-quit` grades the return over a
// match posed rather than confirmed, and reads back the `0` a fresh title carries.
//
// The field is emptied. The check passes through a real countdown, which is the
// one screen here that advances anything, and this point concerns neither a ball
// nor an obstacle; `clearWorld` removes them outright rather than parking them
// somewhere harmless.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  clearField,
  createHarness,
  type Harness,
} from "../harness";
import { TITLE_HOWTO, TITLE_SOLO, selectTitle } from "./screens";

/** The pause menu's third entry (specs/ui.md, `PAUSE_ITEMS`). */
const QUIT_TO_MENU = PAUSE_ITEMS.indexOf("QUIT TO MENU");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title on SOLO", async () => {
  await selectTitle(h, TITLE_SOLO);
  await h.debug.setTitleIndex(TITLE_HOWTO);
  assertEqual((await h.snapshot()).titleIndex, TITLE_HOWTO);

  await h.tap("Enter");
  const started = await h.snapshot();
  assertEqual(started.screen, "countdown");
  assertEqual(started.mode, "solo");
  assertEqual(started.titleIndex, TITLE_SOLO);

  await clearField(h);
  await h.debug.setResumeScreen("countdown");
  await h.debug.setMenuIndex(QUIT_TO_MENU);
  await h.debug.setScreen("paused");

  await h.tap("Enter");
  await captureStill(h, "title");

  const title = await h.snapshot();
  assertEqual(title.screen, "title");
  assertEqual(title.titleIndex, TITLE_SOLO);
  assertEqual(title.menuIndex, TITLE_SOLO);
});
