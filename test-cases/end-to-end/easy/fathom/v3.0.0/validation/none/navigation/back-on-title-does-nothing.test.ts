// navigation/back-on-title-does-nothing — the title is where `back` stops.
//
// specs/ui.md's transition table carries the row explicitly: `"title"` + `back`
// -> `"title"`, "Nothing changes." It is stated because it is a rule a build can
// break in two different ways — leaving the screen, and moving the selection —
// and both leave a player who pressed Escape somewhere they did not ask to be.
//
// THE SELECTION IS POSED OFF ITS FIRST ITEM FIRST. A title sitting on `DIVE` would
// read `0` back whether the build left the selection alone or reset it, so the
// highlight is posed onto the second entry with `setMenuIndex`
// (specs/instrumentation.md) and read back after the press. `titleIndex`, the
// score, the lives and the depth are read beside it, because "nothing changes" is
// the whole of the row.
//
// Nothing advances on `"title"` (specs/ui.md), so the snapshot taken before the
// press is a reading the press alone could have moved.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual } from "../assert";
import { BINDINGS, TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  openTitle,
  type Harness,
} from "../harness";

/** The key specs/movement.md binds `back` to. */
const KEY = BINDINGS.back[0];

/** The title entry the selection is posed onto: not the one a reset leaves it on. */
const HOWTO = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the title, its selection and the run exactly as they stood", async () => {
  await openTitle(h);
  await h.debug.setMenuIndex(HOWTO);
  const before = await h.snapshot();
  assertEqual(before.screen, "title", "the screen the press is made on");
  assertEqual(before.menuIndex, HOWTO, "the posed title selection");

  await h.tap(KEY);
  const after = await h.snapshot();
  // Before the assertions, so a failing check still leaves the screen it read.
  await captureStill(h, "title");

  assertEqual(
    after.screen,
    "title",
    "the screen `back` pressed on the title reaches, which is the title " +
      "itself (specs/ui.md)",
  );
  assertEqual(
    after.menuIndex,
    before.menuIndex,
    "the title's selection across a `back` press, which changes nothing " +
      "(specs/ui.md)",
  );
  assertEqual(
    after.titleIndex,
    before.titleIndex,
    "the title's remembered selection across a `back` press (specs/ui.md)",
  );
  assertEqual(after.score, before.score, "the score across a `back` press");
  assertEqual(after.lives, before.lives, "the lives across a `back` press");
  assertEqual(after.depth, before.depth, "the depth across a `back` press");
});
