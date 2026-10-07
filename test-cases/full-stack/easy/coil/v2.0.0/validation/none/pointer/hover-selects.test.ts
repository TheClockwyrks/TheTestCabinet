// pointer/hover-selects — moving the pointer onto an item selects it.
//
// specs/ui.md, "Pointer and touch", in one direction: "A pointer moves onto an
// item's region" makes `menuIndex` "that item's index". No button is pressed, and
// `screen` is read back beside the index: a move alone selects and confirms
// nothing. The confirm is `pointer/click-confirms`.
//
// WHERE the item is drawn is the build's own. specs/ui.md leaves the layout of a
// menu to the build and fixes only that each item occupies a region and that a
// pointer over that region selects it, so the region comes from `menuItemRect`
// (specs/instrumentation.md) and the device is driven to its middle. A build that
// lays its menu out any way it likes passes, and one that reports a region it
// does not answer on fails.
//
// The title is opened by a reset and the selection posed with `setMenuIndex`,
// which is the precondition this point names; the only thing driven after that is
// the device, so what is read back can have come from nowhere else. Walking the
// arrows to the item would fail this point for a broken down edge, which is
// `controls/menu-highlight-moves`'s to report.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOWTO_INDEX } from "../constants";
import {
  captureStill,
  createHarness,
  hoverMenuItem,
  openTitle,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("selects the item the pointer moves onto", async () => {
  await openTitle(h);
  await h.debug.setMenuIndex(0);
  const posed = await h.snapshot();
  assertEqual(posed.screen, "title", "the screen the pointer is moved over");
  assertEqual(posed.menuIndex, 0, "the highlighted item before the move");

  await hoverMenuItem(h, HOWTO_INDEX);
  await captureStill(h, "menu");

  const hovered = await h.snapshot();
  assertEqual(hovered.menuIndex, HOWTO_INDEX, "the item the pointer selected");
  assertEqual(hovered.screen, "title", "the screen a move alone left");
});
