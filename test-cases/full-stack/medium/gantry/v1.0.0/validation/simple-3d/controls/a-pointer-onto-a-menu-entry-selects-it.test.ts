// controls/a-pointer-onto-a-menu-entry-selects-it — the pointer moved onto an
// entry's region moves the highlight to it.
//
// `specs/ui.md` § The screens: "The pointer moves onto an entry's region | The
// highlight moves to that entry". The layout is the build's, and the same file
// fixes how a check finds it: "every entry occupies a rectangular hit region on
// the stage, laid out as the build likes and reported by `menuItemRect`".
//
// SO NOTHING HERE KNOWS A MENU COORDINATE. The check asks the build where it
// drew `HOW TO PLAY` and moves the pointer to the middle of what it answered,
// and a build that laid its title menu out anywhere at all passes.
//
// THE HIGHLIGHT IS POSED OFF THE TARGET FIRST, or the reading decides nothing:
// a build whose highlight never moves would sit on the answer by accident. It
// is posed to `SITES` and the pointer is moved onto `HOW TO PLAY`.
//
// ONLY A HOVER. No button goes down, so what is read afterwards is the
// highlight alone — that a press takes the entry is its own point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import { createHarness, pointerOntoItem, type Harness } from "../harness";

/** `HOW TO PLAY`: the entry the pointer is moved onto. */
const TARGET = TITLE_ITEMS.indexOf("HOW TO PLAY");

/** `SITES`: where the highlight is posed, so the move is visible. */
const POSED = TITLE_ITEMS.indexOf("SITES");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the highlight onto the entry the pointer is over", async () => {
  await h.debug.setScreen("title");
  await h.debug.setMenuIndex(POSED);

  const posed = await h.snapshot();
  assertEqual(posed.screen, "title", "the menu screen the pointer moves over");
  assertEqual(posed.menuIndex, POSED, "the highlight the hover has to move");

  await pointerOntoItem(h, TARGET);
  const after = await h.snapshot();

  await h.capture(
    "state",
    "the title menu with the highlight under the pointer",
  );

  assertEqual(
    after.menuIndex,
    TARGET,
    "the entry the pointer was moved onto, reported by menuItemRect " +
      "(specs/ui.md)",
  );
  assertEqual(
    after.screen,
    "title",
    "the screen a hover leaves showing: it selects and takes nothing",
  );
});
