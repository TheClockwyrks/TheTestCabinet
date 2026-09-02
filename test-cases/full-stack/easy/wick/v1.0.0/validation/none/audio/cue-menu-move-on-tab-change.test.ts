// audio/cue-menu-move-on-tab-change — the frame the almanac's tab changes plays
// `menu-move`, exactly once.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("Audio"): "`menu-move` |
// `CUES.menuMove` | A menu highlight moves", and under the table "Each is played
// on the tick its event happens, or on the frame for a menu event, and at most
// once on that tick". specs/ui.md ("Menu navigation") carries the tab bar into
// that rule by name: "Every move of a highlight plays `menu-move`, whichever of
// the two moved it, the level-up overlay's offers and the almanac's tab bar
// included." specs/ui.md ("`almanac`") fixes what one press moves: "`left` and
// `right` move `almanacTab` by one over `ALMANAC_TABS`, wrap at both ends, and
// set `menuIndex` and `almanacScroll` to `0`", and specs/controls.md's action
// table reads the press as an edge on this screen: "`right` | `ArrowRight`,
// `KeyD` | held on `playing`, edge on `almanac`". So one `ArrowRight` on the
// almanac is one move of one highlight, and one move is one `menu-move`.
//
// WHAT THIS DECIDES, AND WHAT IT DOES NOT. The tab bar alone. The three menus
// whose highlight `down` moves are `audio/cue-menu-move`'s point, and a hover
// that moves a highlight is `pointer/title-hover-plays-menu-move`'s; this is the
// route neither of them drives.
//
// WHY THE WORLD IS POSED AS IT IS. `reset` restores "the `title` screen with
// `menuIndex`, `almanacTab`, and `almanacScroll` all `0`", and the almanac is
// then entered through `setScreen("almanac")`, which specs/instrumentation.md
// makes the same arrival as confirming `THE ALMANAC`: "the idle run, `menuIndex`
// `0`, `almanacTab` `0`, `almanacScroll` `0`". The tab the press is made from is
// read back before the press, so a build that opened the screen somewhere else
// fails on that rather than on a cue this check never posed. `ALMANAC_TABS`
// holds four names, so the tab to the right of the first is the second and the
// press moves rather than wrapping onto itself. The press is a REAL
// `ArrowRight` through Chromium's own input pipeline, down for exactly one frame
// and up again, because specs/instrumentation.md carries no operation for the
// keyboard and hands it to the runtime, where "a dispatched keyboard event moves
// the lamplighter and works the menus exactly as a player's key does"; a pose
// would sound nothing, since "A cue is played by a tick or a frame, never by a
// pose of the debug surface" (specs/ui.md).
//
// WHAT IS READ, AND WHY EXACTLY ONCE. The count of `menu-move` in the named-cue
// log for the ONE frame the press ran on, which must be `1`. Reading that frame
// alone is what makes the count decide the rule: a cue a build sounded on the
// frames that opened the screen cannot stand in for the one the tab change owes,
// and a build that sounds the cue twice on the changing frame fails as loudly as
// one that sounds none. The tab is asserted to have moved before the cue is
// read, so a build whose `right` does nothing reports that rather than a missing
// cue. The almanac "carries no music" (specs/ui.md), so no loop starts under the
// frame this reads.
//
// THE TOLERANCE. None: a tab index is exact, and a cue sounded on the frame or
// it did not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  poseScreen,
  pressAction,
  watchNamedCues,
  type Harness,
} from "../harness";
import { assertHeardOnce, SETTLE_FRAMES } from "./cues";

/** The tab the almanac opens on: "`almanacTab` `0`" (specs/instrumentation.md). */
const FIRST_TAB = 0;

/** The tab one `right` reaches from the first, `ALMANAC_TABS` holding four. */
const NEXT_TAB = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("plays menu-move once on the frame ArrowRight changes the almanac's tab", async () => {
  await h.armAudio();
  await h.debug.reset();
  const opened = await poseScreen(h, "almanac");
  await h.step(SETTLE_FRAMES);

  assertEqual(
    opened.screen,
    "almanac",
    "the screen setScreen('almanac') entered",
  );
  assertEqual(
    opened.almanacTab,
    FIRST_TAB,
    "the tab the almanac opened on, which the press is made from",
  );

  const cues = await watchNamedCues(h);
  const changed = await captureReplay(h, "tab", async () => {
    const after = await pressAction(h, "right");
    return { after, frame: h.frame() };
  });

  assertEqual(changed.after.screen, "almanac", "the screen after ArrowRight");
  assertEqual(
    changed.after.almanacTab,
    NEXT_TAB,
    "almanacTab after one ArrowRight on the first tab (specs/ui.md, almanac)",
  );
  assertHeardOnce(
    cues,
    changed.frame,
    "menu-move",
    "the menu-move cues on the frame the almanac's tab changed (specs/ui.md, Audio)",
  );
});
