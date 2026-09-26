// navigation/title-how-to-remembers — activating `HOW TO PLAY` on the title
// records that entry in `titleIndex`.
//
// THE RULE. `specs/screens.md`, the title's item table: "Activating either item
// sets `titleIndex` to that item's index, so `titleIndex` is `0` after
// `NEW GAME` and `1` after `HOW TO PLAY`."
//
// ONE ENTRY, ONE POINT. `navigation/title-new-game-remembers` is the other: a
// build that records one entry and forgets the other is a different build from
// one that records neither, and bundled the two would score the same.
//
// `titleIndex` IS POSED OFF THE ANSWER FIRST, through `setTitleIndex`
// (`specs/instrumentation.md`), so the value read afterwards can only be one
// this activation wrote rather than one it inherited.
//
// WHAT IT DOES NOT DECIDE. What a return to the title RESTORES from the field,
// which is `navigation/howto-back-restores-title-entry`'s and
// `navigation/hud-menu-restores-title-entry`'s, nor which screen the entry
// reaches, which is `screens/title-how-to-opens`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_HOW_TO_ITEM, TITLE_NEW_GAME_ITEM } from "../constants";
import {
  captureStill,
  clickAt,
  createHarness,
  menuPoint,
  openTitle,
  type Harness,
} from "../harness";

/** One frame, so the canvas carries the screen the assertions read. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Activate the item at `index` of the menu the current screen shows. */
async function activate(index: number): Promise<void> {
  const at = menuPoint(h, index);
  clickAt(h, at.x, at.y);
  await h.advance(SETTLE_FRAMES);
}

it("records HOW TO PLAY in titleIndex when it is activated", async () => {
  openTitle(h);
  h.debug.setTitleIndex(TITLE_NEW_GAME_ITEM);
  assertEqual(
    h.snapshot().titleIndex,
    TITLE_NEW_GAME_ITEM,
    "posing: titleIndex before the activation — a field already sitting on " +
      "the answer would let this point pass on a build that never writes it",
  );

  await activate(TITLE_HOW_TO_ITEM);
  const after = h.snapshot();

  // Before the assertions, so a build that remembered the wrong entry still
  // leaves the picture of where the activation went.
  captureStill(h, "howto");

  assertEqual(
    after.screen,
    "howto",
    "posing: the screen HOW TO PLAY reached — an activation that never happened " +
      "says nothing about what it remembered",
  );
  assertEqual(
    after.titleIndex,
    TITLE_HOW_TO_ITEM,
    "titleIndex once HOW TO PLAY was activated — activating either item sets " +
      "titleIndex to that item's index (specs/screens.md)",
  );
});
