// Carom — navigation/title-up: one ArrowUp on the title moves the selection up
// one.
//
// One transition of the menu state machine specs/ui.md fixes, in one direction.
// The title is posed by `openTitle`, which is `reset`: the operation that
// restores every declared field to its title value, `menuIndex` at `0` included
// (specs/state.md). The last entry is then POSED with `setMenuIndex`, which is
// the "on the title with `menuIndex` 2" this point names, rather than walked to
// with down presses — a build whose down edge is broken fails `title-down` and
// still has this point graded on the edge it is about.
//
// The field is left exactly as the title state holds it. Nothing advances on
// `title` (specs/ui.md) and what is read is `screen` and `menuIndex`, which no
// ball and no obstacle can touch, so there is no bystander to remove. Nothing
// takes a paddle either: a menu is not driven through one.
//
// The key is a real key event dispatched at the target the runtime listens on,
// so the action is raised by the binding the case declares. The still is the
// frame the press left.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  openTitle,
  type Harness,
} from "../harness";

/** The title's entries, by index (specs/ui.md, `TITLE_ITEMS`). */
const VERSUS = TITLE_ITEMS.indexOf("VERSUS");
const HOWTO = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the title selection from the last item to the second", async () => {
  assertGreaterThan(TITLE_ITEMS.length, 2);
  openTitle(h);
  h.debug.setMenuIndex(HOWTO);
  const posed = h.snapshot();
  assertEqual(posed.screen, "title");
  assertEqual(posed.menuIndex, HOWTO);

  await h.tap("ArrowUp");
  captureStill(h, "menu");

  const moved = h.snapshot();
  assertEqual(moved.screen, "title");
  assertEqual(moved.menuIndex, VERSUS);
});
