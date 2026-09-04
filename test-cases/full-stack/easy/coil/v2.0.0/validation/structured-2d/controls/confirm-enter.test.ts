// controls/confirm-enter — Enter accepts the highlighted menu item.
//
// specs/controls.md binds `confirm` to `Enter` and `Space`, and on a menu-bearing
// screen `confirm` "Accepts the highlighted item". specs/ui.md then makes the
// title's first item the mode's entry, whose acceptance "starts a round, which
// sets `screen` to `playing`" — so the screen the game is on afterwards is the
// reading that says the key was accepted.
//
// The title is opened by resetting, so the highlight is on the first item without
// a key having moved it, and the ONE key this point is about is the one pressed.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTitle,
  type Harness,
} from "../harness";

/** `Enter` is the first key `specs/controls.md` binds to `confirm`. */
const ENTER = BINDINGS.confirm[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("accepts the highlighted title item on Enter", async () => {
  const title = openTitle(h);
  assertEqual(title.screen, "title", "the screen the key is pressed on");
  assertEqual(title.menuIndex, 0, "the highlighted item");

  await h.tap(ENTER);
  captureStill(h, "enter");

  assertEqual(
    h.snapshot().screen,
    "playing",
    "the screen Enter on the mode entry opened",
  );
});
