// pointer/paused-hover-highlights — the pointer resting on `MAIN MENU` moves
// the pause menu's highlight to it.
//
// WHAT THIS DECIDES. One thing: on `paused` with `menuIndex` `0`, a frame that
// finds the pointer inside the rectangle of the item at position `1` leaves
// `menuIndex` at `1`. What clicking either item does is its own point.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md (The pointer): "Every screen that shows a vertical menu
//   answers the pointer: `title`, `almanac`, `levelup`, `paused`, `fallen`, and
//   `dawn`", and "On `title`, `levelup`, `paused`, `fallen`, and `dawn` ... the
//   rectangle at position `i` belongs to the item at `menuIndex` `i`." Rule 1:
//   "The pointer inside the rectangle of the item at `menuIndex` `i`, with
//   `menuIndex` not `i`, sets `menuIndex` to `i` and plays `menu-move`."
//   specs/ui.md (`paused`): "the menu `PAUSE_ITEMS` below it: `RESUME`,
//   `MAIN MENU`, in that order", and "`menuIndex` is `0` on arriving".
//   specs/instrumentation.md (Menus): `menuRects` reports one rectangle per
//   item of the menu the screen shows, in menu order.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. `menuIndex` off the snapshot
// after one frame with the pointer at rest inside the rectangle the build
// itself reported for position `1`, which `PAUSE_ITEMS` names `MAIN MENU`. The
// specification fixes no coordinate for the pause menu, so the aim comes from
// the build's own reading.
//
// THE DRIVE. An isolated `playing` run, paused through `setScreen("paused")`,
// which enters the screen "Exactly as `pause` does" (specs/instrumentation.md),
// so a build with a broken pause key still reaches the screen this point is
// about. Then the pointer to the middle of the reported rectangle and one
// frame: the rules are "applied on every frame, after that frame's press edges
// and before its update" (specs/controls.md). Nothing advances on `paused`
// (specs/ui.md), so that frame moves no run.
//
// THE TOLERANCE. None: a menu index is a discrete figure.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  hoverRect,
  isolate,
  type Harness,
} from "../harness";
import { menuRectAt } from "./pointing";

let h: Harness;

/** The item the pointer rests on: `MAIN MENU`, position 1 of `PAUSE_ITEMS`. */
const HOVERED = PAUSE_ITEMS.indexOf("MAIN MENU");

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("moves the pause highlight to the item the pointer rests in", async () => {
  isolate(h);
  h.debug.setScreen("paused");
  const before = h.snapshot();
  assertEqual(before.screen, "paused", "the screen the pointer rests on");
  assertEqual(before.menuIndex, 0, "the highlight before the pointer moves");

  const rect = menuRectAt(h, HOVERED, "the MAIN MENU item");
  const after = await hoverRect(h, rect);
  captureStill(h, "hover");

  assertEqual(after.screen, "paused", "the screen a hover left the game on");
  assertEqual(
    after.menuIndex,
    HOVERED,
    "the highlight after the pointer rested in position 1's rectangle, which specs/controls.md gives to menuIndex 1",
  );
});
