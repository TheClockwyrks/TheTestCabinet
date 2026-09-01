// screens/howto-names-keys — the how-to screen names the keys each action is
// bound to.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`howto`") lists what the screen
// covers, last of them: "the controls, naming the keys `BINDINGS` gives each
// action: the arrows or `WASD` to move, `Enter` or `Space` to confirm, `Escape`
// to go back, `P` to pause, and `M` to mute." `HOWTO_KEY_NAMES` restates the
// named keys. specs/controls.md ("Actions and bindings") is where those keys
// come from: `ArrowUp`/`KeyW` and its three fellows, `Enter`/`Space`, `Escape`,
// `KeyP`, `KeyM`.
//
// WHY THE WORLD IS POSED AS IT IS. Nothing but the screen: `setScreen("howto")`
// "Enters the how-to screen exactly as confirming `HOW TO PLAY` does", which
// reaches the copy without pressing a menu key, so a build with a broken title
// menu fails the title points and is read here on its how-to screen. One frame
// is then run and what it draws is read.
//
// THE TOLERANCE. specs/ui.md fixes the screen's words as "How to play, written
// in a player's words", so nothing is matched exactly. A key of several letters
// is looked for folded — lower-cased, with spaces, dashes and underscores
// removed — anywhere in the screen's text, and a key of one letter is looked
// for standing alone, bounded by non-letters, because a single letter is a
// substring of nearly any sentence. The arrows are named either as the word or
// as one of the four arrow glyphs, since the specification names them in words
// and a build may draw them.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { HOWTO_KEY_NAMES } from "../constants";
import {
  captureStill,
  createHarness,
  poseScreen,
  type Harness,
} from "../harness";
import { assertNames, assertShows, shown, shows, textOn } from "./stage";

/** The four arrow glyphs a build may draw instead of the word. */
const ARROW_GLYPHS = /[←↑→↓]/;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("names the arrows, WASD, Enter, Space, Escape, P, and M", async () => {
  const howto = await poseScreen(h, "howto");
  assertEqual(howto.screen, "howto", "the screen the frame is read on");

  const page = await shown(h);
  await captureStill(h, "howto");

  assertTrue(
    shows(page, "arrow") || textOn(page).some((run) => ARROW_GLYPHS.test(run)),
    "the how-to screen naming the arrows, in the word or in glyphs",
  );
  for (const key of HOWTO_KEY_NAMES) {
    if (key.length === 1) assertNames(page, key, "the how-to screen");
    else assertShows(page, key, "the how-to screen");
  }
});
