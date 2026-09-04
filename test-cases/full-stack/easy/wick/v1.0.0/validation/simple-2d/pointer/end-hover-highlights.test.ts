// pointer/end-hover-highlights — the pointer resting on `TITLE` moves the end
// screen's highlight to it.
//
// WHAT THIS DECIDES. One thing: on `fallen` with `menuIndex` `0`, a frame that
// finds the pointer inside the rectangle of the item at position `1` leaves
// `menuIndex` at `1`. What clicking an end screen item does is its own point.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md (The pointer): "Every screen that shows a vertical menu
//   answers the pointer: `title`, `almanac`, `levelup`, `paused`, `fallen`, and
//   `dawn`", and "On `title`, `levelup`, `paused`, `fallen`, and `dawn` ... the
//   rectangle at position `i` belongs to the item at `menuIndex` `i`." Rule 1:
//   "The pointer inside the rectangle of the item at `menuIndex` `i`, with
//   `menuIndex` not `i`, sets `menuIndex` to `i` and plays `menu-move`."
//   specs/ui.md ("`fallen` and `dawn`"): "Menu | `END_ITEMS`: `TRY AGAIN`,
//   `TITLE`, in that order", and "`menuIndex` is `0` on arriving".
//   specs/instrumentation.md (Menus): `menuRects` reports one rectangle per
//   item of the menu the screen shows, in menu order.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. `menuIndex` off the snapshot
// after one frame with the pointer at rest inside the rectangle the build
// itself reported for position `1`, which `END_ITEMS` names `TITLE`. The
// specification fixes no coordinate for the end menu, so the aim comes from the
// build's own reading.
//
// WHY `fallen` AND NOT `dawn`. The two end screens carry the same menu and the
// same rules; the hover rule is about a menu answering the pointer, and one of
// the two decides it.
//
// THE DRIVE. An isolated `playing` run ended through `setScreen("fallen")`,
// which "Ends the run exactly as that ending does, the run kept for the end
// screen to report" (specs/instrumentation.md), so the ending's own rules are
// not on the way in. Then the pointer to the middle of the reported rectangle
// and one frame: the rules are "applied on every frame, after that frame's
// press edges and before its update" (specs/controls.md).
//
// THE TOLERANCE. None: a menu index is a discrete figure.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { END_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  hoverRect,
  isolate,
  type Harness,
} from "../harness";
import { menuRectAt } from "./pointing";

let h: Harness;

/** The item the pointer rests on: `TITLE`, position 1 of `END_ITEMS`. */
const HOVERED = END_ITEMS.indexOf("TITLE");

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("moves the fallen highlight to the item the pointer rests in", async () => {
  isolate(h, { level: 11 });
  h.debug.setTick(6000);
  h.debug.setKills(52);
  h.debug.setScreen("fallen");
  const before = h.snapshot();
  assertEqual(before.screen, "fallen", "the screen the pointer rests on");
  assertEqual(before.menuIndex, 0, "the highlight before the pointer moves");

  const rect = menuRectAt(h, HOVERED, "the TITLE item");
  const after = await hoverRect(h, rect);
  captureStill(h, "hover");

  assertEqual(after.screen, "fallen", "the screen a hover left the game on");
  assertEqual(
    after.menuIndex,
    HOVERED,
    "the highlight after the pointer rested in position 1's rectangle, which specs/controls.md gives to menuIndex 1",
  );
});
