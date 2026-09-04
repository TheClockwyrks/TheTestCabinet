// audio/cue-menu-confirm-on-pause-item — the frame a pause menu item is
// confirmed plays `menu-confirm`, exactly once.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("Audio"): "`menu-confirm` |
// `CUES.menuConfirm` | An item of `TITLE_ITEMS`, `PAUSE_ITEMS`, or `END_ITEMS`
// is confirmed", and under the table "Each is played on the tick its event
// happens, or on the frame for a menu event, and at most once on that tick".
// specs/ui.md ("Menu navigation") states the same bound: "`menu-confirm` plays
// when an item of `TITLE_ITEMS`, `PAUSE_ITEMS`, or `END_ITEMS` is confirmed".
// `PAUSE_ITEMS` is the one of the three lists no other point of this category
// sounds, so a build that wired the cue into the title menu and the end screens
// alone has met the rule on two of the three lists it names and fails here.
//
// WHY `RESUME`. specs/ui.md ("`paused`") gives the screen "the menu
// `PAUSE_ITEMS` below it: `RESUME`, `MAIN MENU`, in that order", with
// "`menuIndex` is `0` on arriving" and "`confirm` takes the highlighted item".
// `RESUME` is therefore the item the screen already highlights, so the
// confirming frame is reached with no move pressed before it and carries no
// `menu-move` of its own; and "`RESUME` | Sets `screen = playing`, with the run
// untouched" is the transition read back as evidence that the item really was
// taken.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: a fresh `playing` run with
// every driver switch off, nothing alive, nothing dropped and no slot held, then
// the settling frames this category spends before it watches anything, then
// `setScreen("paused")`, which specs/instrumentation.md makes the played
// transition ("`paused` | `playing` | Exactly as `pause` does"). The frame that
// confirms `RESUME` enters `playing` and so "runs that frame's ticks"
// (specs/controls.md); over a world holding nothing with every faculty off that
// tick raises no cue of its own. `music` is looping across both `paused` and
// `playing` (specs/ui.md, The loops), so no loop starts on the frame either. The
// press is a REAL `Enter`, which specs/controls.md binds to `confirm` as an
// edge, down for exactly one frame and up again: specs/instrumentation.md hands
// the keyboard to the runtime, where "a dispatched keyboard event moves the
// lamplighter and works the menus exactly as a player's key does", and a pose
// sounds nothing, since "A cue is played by a tick or a frame, never by a pose
// of the debug surface" (specs/ui.md).
//
// WHAT IS READ, AND WHY EXACTLY ONCE. The count of `menu-confirm` in the
// named-cue log for the ONE frame the press ran on, which must be `1`. Reading
// that frame alone is what makes the count decide the rule: a cue a build
// sounded while the pause was being posed cannot stand in for the one the
// confirmation owes, and a build that sounds the cue twice on the confirming
// frame fails as loudly as one that sounds none.
//
// THE TOLERANCE. None: a screen name and a menu index are exact, and a cue
// sounded on the frame or it did not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  captureReplay,
  createHarness,
  poseScreen,
  pressConfirm,
  watchNamedCues,
  type Harness,
} from "../harness";
import { assertHeardOnce, openNight } from "./cues";

/** Where `RESUME` stands in `PAUSE_ITEMS` (specs/ui.md, `paused`). */
const RESUME = PAUSE_ITEMS.indexOf("RESUME");

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("plays menu-confirm once on the frame Enter takes RESUME", async () => {
  await openNight(h);
  const paused = await poseScreen(h, "paused");

  assertEqual(paused.screen, "paused", "the screen the confirm is made on");
  assertEqual(
    paused.menuIndex,
    RESUME,
    "the item the pause arrives highlighting, RESUME (specs/ui.md, paused)",
  );

  const cues = await watchNamedCues(h);
  const taken = await captureReplay(h, "pause", async () => {
    const after = await pressConfirm(h);
    return { after, frame: h.frame() };
  });

  assertEqual(
    taken.after.screen,
    "playing",
    "the screen confirming RESUME left (specs/ui.md, paused)",
  );
  assertHeardOnce(
    cues,
    taken.frame,
    "menu-confirm",
    "the menu-confirm cues on the frame a pause item was confirmed (specs/ui.md, Audio)",
  );
});
