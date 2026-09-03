// Wick — audio/cue-menu-confirm: a frame on which `confirm` takes an item of
// `TITLE_ITEMS` or `END_ITEMS` plays `menu-confirm`. The rule specs/ui.md
// states carries `PAUSE_ITEMS` under the same cue; the two confirmations read
// here are the two this point names.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/ui.md (Audio): "`menu-confirm` | `CUES.menuConfirm` | An item of
//     `TITLE_ITEMS`, `PAUSE_ITEMS`, or `END_ITEMS` is confirmed", and "Each is
//     played ... on the frame for a menu event".
//   - specs/ui.md (Menu navigation): "`menu-confirm` plays when an item of
//     `TITLE_ITEMS`, `PAUSE_ITEMS`, or `END_ITEMS` is confirmed".
//   - specs/ui.md (`title`): `TITLE_ITEMS` is "`LIGHT THE LAMP`, `THE
//     ALMANAC`, `HOW TO PLAY`, in that order", so `HOW TO PLAY` is the item at
//     index `2`, and it "Sets `screen = howto`".
//   - specs/ui.md (`fallen` and `dawn`): `END_ITEMS` is "`TRY AGAIN`, `TITLE`,
//     in that order", and `TRY AGAIN` "starts a fresh run and sets
//     `screen = playing`". "`menuIndex` is `0` on arriving".
//   - specs/controls.md: `confirm` is bound to `Enter` and `Space` and is read
//     as a press edge.
//
// WHAT IS READ. Exactly one `menu-confirm` play across the frame that confirms
// `HOW TO PLAY`, and one across the frame that confirms `TRY AGAIN`, with the
// screen each confirmation leads to as the evidence that the item really was
// taken.
//
// WHY THE SCREENS ARE REACHED AS THEY ARE. Each is entered through the debug
// surface, "exactly as the real transition into it enters it"
// (specs/instrumentation.md, `setScreen`), so no unrelated menu stands between
// the point and its frame. On the title the highlight is walked down to
// `HOW TO PLAY` before the recording opens, so the `menu-move` each of those
// moves sounds belongs to the other point and not to this one; on `fallen` the
// item confirmed is the one `menuIndex` `0` already holds, so no move is needed
// at all.
//
// TOLERANCE. None. Every reading is a count or a discrete screen.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureReplay,
  createHarness,
  onCue,
  poseScene,
  tap,
  type Harness,
} from "../harness";
import { CONFIRM_KEY, DOWN_KEY, assertPlayed } from "./cues";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays menu-confirm on the frame HOW TO PLAY and TRY AGAIN are confirmed", async () => {
  poseScene(h, "title");
  const wanted = TITLE_ITEMS.indexOf("HOW TO PLAY");
  let highlighted = h.snapshot();
  for (let press = 0; press < wanted; press += 1) {
    highlighted = await tap(h, DOWN_KEY);
  }
  assertEqual(highlighted.menuIndex, wanted, "the highlight on HOW TO PLAY");
  const onTitle = onCue(h);

  const title = await captureReplay(h, "confirm", () => tap(h, CONFIRM_KEY));

  assertEqual(title.screen, "howto", "the screen HOW TO PLAY led to");
  assertPlayed(
    onTitle,
    "menu-confirm",
    1,
    "menu-confirm cues on the title's frame",
  );

  poseScene(h, "fallen");
  const onFallen = onCue(h);

  const fallen = await tap(h, CONFIRM_KEY);

  assertEqual(fallen.screen, "playing", "the screen TRY AGAIN led to");
  assertPlayed(
    onFallen,
    "menu-confirm",
    1,
    "menu-confirm cues on the fallen frame",
  );
});
