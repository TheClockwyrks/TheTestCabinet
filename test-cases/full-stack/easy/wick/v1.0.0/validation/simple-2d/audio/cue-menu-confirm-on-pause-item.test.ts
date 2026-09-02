// Wick — audio/cue-menu-confirm-on-pause-item: a frame on which `confirm` takes
// an item of `PAUSE_ITEMS` plays `menu-confirm`, once.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/ui.md (Audio): "`menu-confirm` | `CUES.menuConfirm` | An item of
//     `TITLE_ITEMS`, `PAUSE_ITEMS`, or `END_ITEMS` is confirmed", and "Each is
//     played on the tick its event happens, or on the frame for a menu event,
//     and at most once on that tick".
//   - specs/ui.md (Menu navigation): "`menu-confirm` plays when an item of
//     `TITLE_ITEMS`, `PAUSE_ITEMS`, or `END_ITEMS` is confirmed".
//   - specs/ui.md (`paused`): the menu is `PAUSE_ITEMS`, "`RESUME`, `MAIN
//     MENU`, in that order", "`menuIndex` is `0` on arriving ... `confirm`
//     takes the highlighted item", and "`RESUME` | Sets `screen = playing`,
//     with the run untouched".
//   - specs/controls.md: `confirm` is bound to `Enter` and `Space`, read as a
//     press edge, and the `paused` row is "`confirm` takes the highlighted
//     item".
//   - specs/instrumentation.md (`setScreen`): "`paused` | `playing` | Exactly
//     as `pause` does", which is how the pause is posed without a key.
//
// WHAT THIS DECIDES. `PAUSE_ITEMS`, the one of the three lists the rule names
// that no other point of this category sounds: `audio/cue-menu-confirm` drives
// `TITLE_ITEMS` and `END_ITEMS`, so a build that wired the cue into those two
// alone fails here.
//
// WHY `RESUME`, AND WHY THE WORLD IS POSED AS IT IS. `RESUME` is the item the
// pause already highlights, so the confirming frame is reached with no move
// pressed before it and carries no `menu-move` of its own. The night beneath is
// isolated — a fresh `playing` run with every driver switch off, nothing alive,
// nothing dropped, no slot held — and one frame is spent on it before the pause
// so that the music bed's own start falls outside the frame this reads. The
// confirming frame enters `playing` and so "runs that frame's ticks"
// (specs/controls.md); over a world holding nothing with every faculty off that
// tick raises no cue, and `music` loops across both `paused` and `playing`
// (specs/ui.md, The loops), so nothing starts on it either.
//
// WHAT IS READ, AND WHY EXACTLY ONCE. The plays of `menu-confirm` on the ONE
// frame the press ran on, which must number `1`. Reading that frame alone is
// what makes the count decide the rule: a cue sounded while the pause was being
// posed cannot stand in for the one the confirmation owes, and a build that
// sounds it twice on the confirming frame fails as loudly as one that sounds
// none. The screen the confirmation reached is asserted first, so a build whose
// pause menu does nothing reports that instead.
//
// TOLERANCE. None. Every reading is a count or a discrete screen.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  captureReplay,
  createHarness,
  cuesOnFrame,
  isolate,
  onCue,
  tap,
  type Harness,
} from "../harness";
import { CONFIRM_KEY, assertPlayed } from "./cues";

/** Where `RESUME` stands in `PAUSE_ITEMS` (specs/ui.md, `paused`). */
const RESUME = PAUSE_ITEMS.indexOf("RESUME");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays menu-confirm once on the frame Enter takes RESUME", async () => {
  isolate(h);
  await h.tick(1);
  h.debug.setScreen("paused");
  const paused = h.snapshot();
  assertEqual(paused.screen, "paused", "the screen Enter is pressed on");
  assertEqual(paused.menuIndex, RESUME, "the highlight resting on RESUME");

  const onPause = onCue(h);
  const after = await captureReplay(h, "pause", () => tap(h, CONFIRM_KEY));

  assertEqual(after.screen, "playing", "the screen Enter left the game on");
  assertPlayed(
    cuesOnFrame(onPause, h.frame()),
    "menu-confirm",
    1,
    "menu-confirm cues on the frame a pause item was confirmed",
  );
});
