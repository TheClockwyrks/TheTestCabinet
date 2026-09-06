// Spectra — touch/pause-drag-cancels: a contact that lifts elsewhere on the pause
// menu takes nothing.
//
// THE RULE. `specs/ui.md`, "Pointer and touch": "A confirm requires both of its edges
// inside one item's region: ... the landing and the lift for a touch contact. Two
// edges that fall in different regions ... confirm no item." It holds over the items
// each of the three menu screens shows, and this point decides it on the PAUSED
// screen: whether THIS screen pairs the two edges is a thing a build decides for
// itself.
//
// HOW THE SCREEN IS REACHED. `posePausedMenu` opens a live wave and then PLACES the
// screen and the highlight: `setScreen` and `setMenuIndex` are what
// `specs/instrumentation.md` provides for posing them, so the `pause` key is never
// pressed on the way in and the menu keys cannot fail this point. The pose leaves
// `RESUME`, the first entry, highlighted, and the copy at the index driven is held
// against `specs/ui.md`'s own before the gesture.
//
// WHAT IS DRIVEN. One contact lands inside `RESUME`'s region — the entry the pose
// already highlights — travels onto `QUIT TO MENU`'s region while held, and lifts
// there. Nothing is confirmed, and the selection followed the finger, so the
// highlight is on `QUIT TO MENU`, the item the contact ended over — the travel rule
// `specs/ui.md` states in the same table.
//
// WHY THE CONTACT LANDS ON THE HIGHLIGHTED ITEM. A cancel is a negative claim, and a
// build that reads no touch on this screen satisfies a negative claim for free:
// leave the gesture ending where the pose already put the highlight and both
// readings come out right for a build with no touch code in it. Landing on the entry
// the highlight is ALREADY on and lifting on another makes this point read back a
// highlight that MOVED, which is what makes the negative claim decidable rather than
// free.
//
// EVERY WRONG MODEL READS AS A DIFFERENT SCREEN. A build that confirms on the
// landing edge confirms `RESUME` and reaches `inWave`; a build that confirms on the
// lift edge alone confirms `QUIT TO MENU` and reaches `title`; a build that never
// saw the contact is on `paused` with `menuIndex` still `0`, and fails on the
// highlight. Only a build that requires BOTH edges in one region is on `paused` with
// the highlight on `QUIT TO MENU`.
//
// WHERE THE ITEMS ARE, IS THE BUILD'S: both regions come from the build's own
// `menuItemRect` (`specs/instrumentation.md`), so any layout passes.
//
// WHAT IS NOT ASSERTED. Anything about audio: `specs/ui.md`'s `paused` section
// says the frozen field plays no cue, while its cue table lists a `menu` cue
// for a moved highlight, and that tension is pre-existing — no point here
// depends on how it resolves. Nor what the paused screen draws, which is
// `screens/pause-menu-items`'s; nor that the keyboard `confirm` reaches these
// entries, which is `screens/pause-quit`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  posePausedMenu,
  touchBetweenItems,
  type Harness,
} from "../harness";

/**
 * The pause menu's entries, by index, and the copy at the one driven.
 *
 * `specs/ui.md` fixes `PAUSE_ITEMS` as "`RESUME`, `RESTART`, `QUIT TO MENU`, in
 * that order", so `RESUME` is `0` and `QUIT TO MENU` is `2`. The order and the
 * copy are the specification's; the check reads them off the project's own
 * `PAUSE_ITEMS` and holds the entry it drives against the copy before driving it.
 */
const RESUME_INDEX = 0;
const QUIT_INDEX = 2;
const QUIT_ITEM = "QUIT TO MENU";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("confirms nothing when the contact lifts in another pause-menu item", async () => {
  await posePausedMenu(h, RESUME_INDEX);

  assertEqual(
    PAUSE_ITEMS[QUIT_INDEX],
    QUIT_ITEM,
    "the third PAUSE_ITEMS entry is QUIT TO MENU (specs/ui.md)",
  );
  const posed = h.snapshot();
  assertEqual(posed.screen, "paused", "the game is on the paused screen");
  assertEqual(
    posed.menuIndex,
    RESUME_INDEX,
    "with RESUME, its first entry, highlighted before the gesture",
  );

  await touchBetweenItems(h, RESUME_INDEX, QUIT_INDEX);
  captureStill(h, "paused");

  const after = h.snapshot();
  assertEqual(
    after.screen,
    "paused",
    "the screen a contact landing in one item and lifting in another reaches: " +
      "neither is confirmed (specs/ui.md, Pointer and touch)",
  );
  assertEqual(
    after.menuIndex,
    QUIT_INDEX,
    `menuIndex after the held contact travelled onto ${QUIT_ITEM}'s region, ` +
      "which selects it (specs/ui.md)",
  );
});
