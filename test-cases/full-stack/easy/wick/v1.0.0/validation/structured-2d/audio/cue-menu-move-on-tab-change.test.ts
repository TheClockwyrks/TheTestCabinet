// Wick — audio/cue-menu-move-on-tab-change: the frame the almanac's tab changes
// plays `menu-move`, once.
//
// WHERE THE THRESHOLD COMES FROM. `specs/ui.md`, Audio: the cue table binds
// `menu-move` to "A menu highlight moves", and "Each is played on the tick its
// event happens, or on the frame for a menu event, and at most once on that
// tick." `specs/ui.md`, Menu navigation, carries the tab bar into that rule by
// name: "Every move of a highlight plays `menu-move`, whichever of the two
// moved it, the level-up overlay's offers and the almanac's tab bar included."
// `specs/ui.md`, "`almanac`", fixes what one press moves: "`left` and `right`
// move `almanacTab` by one over `ALMANAC_TABS`, wrap at both ends, and set
// `menuIndex` and `almanacScroll` to `0`", and `specs/controls.md` gives the
// `almanac` row "`left`, `right` move the tab, wrapping" and reads the press as
// an edge there. One `ArrowRight` on the almanac is one move of one highlight,
// and one move is exactly one `menu-move`.
//
// WHAT THIS DECIDES, AND WHAT IT DOES NOT. The tab bar alone. The three menus
// a `down` press moves are `audio/cue-menu-move`'s point, and the pointer's
// hover is `pointer/title-hover-plays-menu-move`'s; this is the route neither
// of them drives.
//
// WHY THE WORLD IS POSED AS IT IS. `reset`, which restores "the `title` screen
// with `menuIndex`, `almanacTab`, and `almanacScroll` all `0`", and then the
// almanac posed through the debug surface, which enters it by setting `screen`
// with `menuIndex`, `almanacTab`, and `almanacScroll` all `0` and the run left
// as it stands (`specs/instrumentation.md`). The tab the press is made from is
// read back first, so a build that opened the screen elsewhere fails on that
// rather than on a cue this point never posed. `ALMANAC_TABS` holds four names,
// so the tab to the right of the first is the second and the press moves rather
// than wrapping onto itself. The move itself is a real `ArrowRight`, and a pose
// "sounds nothing" (`specs/instrumentation.md`), so the event this cue belongs
// to only happens on a frame a key press makes. The almanac "carries no music"
// (`specs/ui.md`), so no bed starts under the frame this reads.
//
// WHAT IS READ, AND WHY EXACTLY ONCE. The cues the collector holds for the ONE
// frame the press ran on, counted by name, which must be `1`. Reading that
// frame alone is what makes the count decide the rule: a cue sounded while the
// screen was being posed cannot stand in for the one the tab change owes, and a
// build that sounds it twice on the changing frame fails as loudly as one that
// sounds none.
//
// THE TOLERANCE. None: a tab index is exact, and the collector reads whole
// frames.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CUES } from "../constants";
import {
  captureReplay,
  createHarness,
  cuesOnFrame,
  poseScreen,
  tap,
  type Harness,
} from "../harness";
import { cuesOf, heard } from "./cues";

/** The key `specs/controls.md` binds `right` to. */
const RIGHT = "ArrowRight";

/** The tab the almanac opens on, and the one a single `right` reaches. */
const FIRST_TAB = 0;
const NEXT_TAB = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays menu-move once on the frame one ArrowRight changes the tab", async () => {
  await captureReplay(h, "tab", async () => {
    h.reset();
    const posed = poseScreen(h, "almanac");
    assertEqual(posed.screen, "almanac", "the screen the press is made on");
    assertEqual(posed.almanacTab, FIRST_TAB, "almanacTab before the press");

    const change = await cuesOf(h, () => tap(h, RIGHT));
    assertEqual(
      change.result.screen,
      "almanac",
      "the screen after ArrowRight (specs/ui.md, almanac)",
    );
    assertEqual(
      change.result.almanacTab,
      NEXT_TAB,
      "almanacTab after one ArrowRight from the first tab (specs/ui.md, almanac)",
    );
    assertEqual(
      heard(cuesOnFrame(change.played, h.frame()), CUES.menuMove),
      1,
      "menu-move cues on the frame the almanac's tab changed (specs/ui.md, Audio)",
    );
  });
});
