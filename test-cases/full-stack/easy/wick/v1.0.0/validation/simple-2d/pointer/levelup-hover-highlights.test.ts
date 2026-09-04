// pointer/levelup-hover-highlights — the pointer resting on the second offer
// moves the overlay's highlight to it.
//
// WHAT THIS DECIDES. One thing: on `levelup` holding three offers with
// `menuIndex` `0`, a frame that finds the pointer inside the rectangle of the
// offer at position `1` leaves `menuIndex` at `1`. What accepting that offer
// does is its own point.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md (The pointer): "Every screen that shows a vertical menu
//   answers the pointer: `title`, `almanac`, `levelup`, `paused`, `fallen`, and
//   `dawn`", and "On `title`, `levelup`, `paused`, `fallen`, and `dawn` ... the
//   rectangle at position `i` belongs to the item at `menuIndex` `i`." Rule 1:
//   "The pointer inside the rectangle of the item at `menuIndex` `i`, with
//   `menuIndex` not `i`, sets `menuIndex` to `i` and plays `menu-move`."
//   specs/ui.md (`levelup`): "`menuIndex` is `0` on arriving", and "`up` and
//   `down` move the highlight and wrap at both ends".
//   specs/instrumentation.md (`setNextOffers`): "the overlay then presents
//   exactly that list in that order", so the offer at position `1` is known.
//   specs/instrumentation.md (Menus): `menuRects` reports one rectangle per
//   item of the menu the screen shows, in menu order.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. `menuIndex` off the snapshot
// after one frame with the pointer at rest inside the rectangle the build
// itself reported for position `1`. The specification fixes no coordinate for
// the overlay, so the aim comes from the build's own reading; what is asserted
// is the relation the spec fixes between a position and an index.
//
// THE DRIVE. An isolated `playing` run with nothing on the field and every
// driver switch off, three offers posed, and the overlay opened by the tick a
// queued level-up opens it, which is the real path
// (specs/progression.md). Then the pointer to the middle of the reported
// rectangle and one frame: the rules are "applied on every frame, after that
// frame's press edges and before its update" (specs/controls.md). Nothing
// advances on `levelup` (specs/ui.md), so that frame changes nothing else.
//
// THE TOLERANCE. None: a menu index is a discrete figure.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  hoverRect,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";
import { menuRectAt } from "./pointing";

let h: Harness;

/** Three weapons no run holds after `isolate`, so each offer is named by id. */
const OFFERS = ["ember", "shard", "pin"] as const;
const HOVERED = 1;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("moves the overlay highlight to the offer the pointer rests in", async () => {
  isolate(h);
  h.debug.setNextOffers([...OFFERS]);
  const opened = await openLevelUp(h, 1);
  assertEqual(opened.screen, "levelup", "the screen the overlay opened on");
  assertDeepEqual(
    opened.run.offers,
    [...OFFERS],
    "the offers the overlay presents",
  );
  assertEqual(opened.menuIndex, 0, "the highlight before the pointer moves");

  const rect = menuRectAt(h, HOVERED, "the second offer");
  const after = await hoverRect(h, rect);
  captureStill(h, "hover");

  assertEqual(after.screen, "levelup", "the screen a hover left the game on");
  assertEqual(
    after.menuIndex,
    HOVERED,
    "the highlight after the pointer rested in position 1's rectangle, which specs/controls.md gives to menuIndex 1",
  );
});
