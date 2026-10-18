// Carom — navigation/space-confirms: Space confirms a menu item.
//
// `confirm` is bound to BOTH `Enter` and `Space` (specs/ui.md), and a build that
// wired only the first satisfies every other navigation point in this category.
// So this point drives the second binding, and it drives it on the one title
// entry whose confirmation changes nothing but the screen: `HOW TO PLAY`.
//
// The selection is put on that entry by `setMenuIndex`, which is the precondition
// this point names; pressing down to it would fail this point for a broken down
// edge, which is `navigation/title-down`'s to report. What is read is that the
// Space press confirmed — `screen` is `howto` — and nothing about how that screen
// looks, which is `ui/state-howto`'s point.
//
// The field is left exactly as the title state holds it. Nothing advances on
// `title` or on `howto` (specs/ui.md) and the reading is of neither a ball nor an
// obstacle, so there is no bystander to remove. No paddle is taken: a menu is not
// driven through one.
//
// The key is a real key event dispatched at the target the runtime listens on,
// so the action is raised by the binding the case declares. The still is the
// frame the press left.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, TITLE_ITEMS } from "../constants";
import { assertContains, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTitle,
  type Harness,
} from "../harness";

const HOWTO = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens the how-to screen when Space confirms the third title item", async () => {
  assertContains(BINDINGS.confirm, "Space");
  assertEqual(TITLE_ITEMS[HOWTO], "HOW TO PLAY");
  openTitle(h);
  h.debug.setMenuIndex(HOWTO);
  const posed = h.snapshot();
  assertEqual(posed.screen, "title");
  assertEqual(posed.menuIndex, HOWTO);

  await h.tap("Space");
  captureStill(h, "howto");

  assertEqual(h.snapshot().screen, "howto");
});
