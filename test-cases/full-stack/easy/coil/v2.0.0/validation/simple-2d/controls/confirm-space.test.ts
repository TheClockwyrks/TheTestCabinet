// controls/confirm-space — Space accepts the highlighted menu item.
//
// specs/controls.md binds `confirm` to `Enter` AND `Space`, and the two are
// interchangeable wherever `confirm` is read. This is its own point rather than a
// repeat of the `Enter` one, because a build that bound only `Enter` is fully
// playable and loses this alone.
//
// The reading is the same: on the title, `confirm` accepts the mode's entry and
// "starts a round, which sets `screen` to `playing`" (specs/ui.md). The title is
// opened by resetting, so the highlight is on the first item without a key having
// moved it.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTitle,
  type Harness,
} from "../harness";

/** `Space` is the second key `specs/controls.md` binds to `confirm`. */
const SPACE = BINDINGS.confirm[1];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("accepts the highlighted title item on Space", async () => {
  const title = openTitle(h);
  assertEqual(title.screen, "title", "the screen the key is pressed on");
  assertEqual(title.menuIndex, 0, "the highlighted item");

  await h.tap(SPACE);
  captureStill(h, "space");

  assertEqual(
    h.snapshot().screen,
    "playing",
    "the screen Space on the mode entry opened",
  );
});
