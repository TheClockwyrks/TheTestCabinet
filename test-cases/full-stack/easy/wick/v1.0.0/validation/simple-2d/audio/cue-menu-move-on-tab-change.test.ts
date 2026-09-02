// Wick — audio/cue-menu-move-on-tab-change: a frame on which `right` changes
// the almanac's tab plays `menu-move`, once.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/ui.md (Audio): "`menu-move` | `CUES.menuMove` | A menu highlight
//     moves", and "Each is played on the tick its event happens, or on the
//     frame for a menu event, and at most once on that tick".
//   - specs/ui.md (Menu navigation): "Every move of a highlight plays
//     `menu-move`, whichever of the two moved it, the level-up overlay's offers
//     and the almanac's tab bar included."
//   - specs/ui.md (`almanac`): "`left` and `right` move `almanacTab` by one
//     over `ALMANAC_TABS`, wrap at both ends, and set `menuIndex` and
//     `almanacScroll` to `0`", with "`almanacTab` ... `0` on arriving".
//   - specs/controls.md: `right` is bound to `ArrowRight` and `KeyD`, and the
//     `almanac` row reads it as a press edge, "`left`, `right` move the tab,
//     wrapping".
//
// WHAT THIS DECIDES, AND WHAT IT DOES NOT. The tab bar alone. The three menus
// a `down` press moves are `audio/cue-menu-move`'s point and a hover that moves
// a highlight is `pointer/title-hover-plays-menu-move`'s; this is the route
// neither of them drives.
//
// WHY THE SCREEN IS REACHED AS IT IS. Through `setScreen("almanac")`, which
// enters it "exactly as confirming `THE ALMANAC` does" (specs/instrumentation.md),
// so the screen stands on its first tab with no key having been pressed and no
// other menu between the point and its frame. `ALMANAC_TABS` holds four names,
// so the tab to the right of the first is the second and the press moves rather
// than wrapping onto itself. The tab the press starts from is read back before
// the recording opens. The almanac "carries no music" (specs/ui.md, The loops),
// so no bed starts under the frame this reads.
//
// WHAT IS READ, AND WHY EXACTLY ONCE. The plays of `menu-move` on the ONE frame
// the press ran on, which must number `1`. Reading that frame alone is what
// makes the count decide the rule: a cue sounded while the screen was being
// posed cannot stand in for the one the tab change owes, and a build that
// sounds it twice on the changing frame fails as loudly as one that sounds
// none. `almanacTab` is asserted to have moved before the cue is read, so a
// build whose `right` does nothing reports that instead.
//
// TOLERANCE. None. Every reading is a count or a discrete index.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  cuesOnFrame,
  onCue,
  poseScene,
  tap,
  type Harness,
} from "../harness";
import { RIGHT_KEY, assertPlayed } from "./cues";

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

it("plays menu-move once on the frame the almanac's tab changes", async () => {
  const posed = poseScene(h, "almanac");
  assertEqual(posed.screen, "almanac", "the screen ArrowRight is pressed on");
  assertEqual(posed.almanacTab, FIRST_TAB, "the tab the almanac opened on");

  const onTab = onCue(h);
  const after = await captureReplay(h, "tab", () => tap(h, RIGHT_KEY));

  assertEqual(after.screen, "almanac", "the screen the press left the game on");
  assertEqual(after.almanacTab, NEXT_TAB, "the tab ArrowRight moved onto");
  assertPlayed(
    cuesOnFrame(onTab, h.frame()),
    "menu-move",
    1,
    "menu-move cues on the frame the almanac's tab changed",
  );
});
