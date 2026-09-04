// Shatter — touch/landing-selects: a contact landing on an entry highlights it.
//
// THE RULE. `specs/ui.md`, "Pointer and touch": "A touch contact lands inside an
// entry's region, or travels onto one | The highlight becomes that entry." A
// landing is not a confirm: `specs/ui.md` gives a confirm both of its edges, and
// this check takes only the first.
//
// WHY TOUCH IS ITS OWN ITEM. A finger has no hover — the first the build hears of
// it is the contact landing — so a build that highlights only on `pointermove`
// leaves a touchscreen player unable to see what they are about to take. That is
// a different fault from a broken mouse, and it costs a different point.
//
// THE PAGE REPORTS A TOUCHSCREEN, asked for by this check alone: the harness opens
// its context with one so the contact arrives as a real touch rather than as a
// mouse, and every check that is not about touch keeps the context the rest of
// this project's evidence was recorded against.
//
// THE GROUND IS POSED AND ONLY THE CONTACT IS DRIVEN, and the screen is read back
// beside the index, so a build that fired the entry on the landing has left the
// title and fails rather than passing on the index it set on the way out.
//
// WHAT THIS ITEM DOES NOT DECIDE. That a tap confirms (`touch/tap-confirms`), or
// that a contact lifted elsewhere confirms nothing (`touch/drag-cancels`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  touchOntoItem,
  type Harness,
} from "../harness";

/** The title's entries, by index (`specs/ui.md`, `TITLE_ITEMS`). */
const PLAY = 0;
const HOW_TO_PLAY = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ touch: true });
});

afterEach(async () => {
  await h.dispose();
});

it("highlights the entry a contact lands on", async () => {
  assertEqual(
    TITLE_ITEMS[HOW_TO_PLAY],
    "HOW TO PLAY",
    "the title entry the contact lands on",
  );

  await h.debug.reset();
  await h.debug.setMenuIndex(PLAY);
  const posed = await h.snapshot();
  assertEqual(posed.screen, "title", "the screen the contact landed on");
  assertEqual(posed.menuIndex, PLAY, "the entry the highlight was posed on");

  await touchOntoItem(h, HOW_TO_PLAY);
  await captureStill(h, "menu");

  const landed = await h.snapshot();
  assertEqual(
    landed.menuIndex,
    HOW_TO_PLAY,
    "the entry the highlight moved to when the contact landed (specs/ui.md)",
  );
  assertEqual(
    landed.screen,
    "title",
    "the screen a landing alone left showing — a confirm needs both of its " +
      "edges (specs/ui.md)",
  );
});
