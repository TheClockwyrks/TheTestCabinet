// Carom — navigation/title-down: one ArrowDown on the title moves the selection
// down one.
//
// One transition of the menu state machine specs/ui.md fixes, in one direction.
// The title is posed by `openTitle`, which is `reset`: the operation that
// restores every declared field to its title value, `menuIndex` at `0` included
// (specs/state.md). That is the precondition this point names, so it is asserted
// off the snapshot before the press rather than assumed.
//
// The field is left exactly as the title state holds it. Nothing advances on
// `title` (specs/ui.md) and what is read is `screen` and `menuIndex`, which no
// ball and no obstacle can touch, so there is no bystander to remove — and a
// title screen emptied of its furniture is a screen the specification never
// describes. Nothing takes a paddle either: a menu is not driven through one.
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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the title selection from the first item to the second", async () => {
  assertGreaterThan(TITLE_ITEMS.length, 1);
  openTitle(h);
  const opened = h.snapshot();
  assertEqual(opened.screen, "title");
  assertEqual(opened.menuIndex, 0);

  await h.tap("ArrowDown");
  captureStill(h, "menu");

  const moved = h.snapshot();
  assertEqual(moved.screen, "title");
  assertEqual(moved.menuIndex, 1);
});
