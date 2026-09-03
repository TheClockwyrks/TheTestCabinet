// Wick — screens/howto-names-keys: the how-to screen names the key each action
// is bound to, and names the mouse the menus also answer.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`howto`", lists
// what the screen covers, ending with "the controls, naming the keys
// `BINDINGS` gives each action: the arrows or `WASD` to move, `Enter` or
// `Space` to confirm, `Escape` to go back or to pause, `P` to pause, and `M`
// to mute, and that every menu answers the mouse as well." `BINDINGS` in
// `specs/controls.md` gives exactly those codes, and its screen table gives
// `back` (`Escape`) both readings the sentence names: "`back` returns to
// `title`" on `howto` and "`back` opens `paused`" on `playing`.
//
// WHAT IS READ, AND WHY IT IS READ THIS LOOSELY. The words of the screen are
// the build's ("How to play, written in a player's words"), and only the KEY
// NAMES and the mouse are fixed, so each is looked for as its own token among
// the strings the frame drew, in any sentence, in any order, ignoring case.
// Two of them are single letters, so `P` and `M` are matched as whole tokens
// (a lone `P`, never the `p` inside a word) or as the `KeyP` and `KeyM` codes
// `BINDINGS` spells; the arrows are matched as the word or as any of the four
// arrow glyphs; `WASD` is matched with any separator between its letters, so
// `W A S D` and `W/A/S/D` read the same as `WASD`; and the pointer is matched
// as the mouse itself or as the click it answers, the two words a screen
// naming it can be written with. `Escape` is one token however many of its
// two duties the sentence around it names, so this point reads that the key
// is named and leaves what it does to the control points.
//
// THE DRIVE. The how-to screen posed through the debug surface, which
// `specs/instrumentation.md` says "Enters the how-to screen exactly as
// confirming `HOW TO PLAY` does", and one frame. The title menu is not
// touched: a build with a broken menu and a correct how-to screen passes
// here and fails the menu's own points.
//
// THE TOLERANCE. The tokens are exact; where they sit and what surrounds them
// is not read at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  drawnText,
  poseScreen,
  type Harness,
} from "../harness";

/**
 * Each key the how-to screen must name, and the mouse it must name beside
 * them, with how each reads as drawn copy.
 */
const KEYS: ReadonlyArray<readonly [string, RegExp]> = [
  ["the arrows", /arrow|[←↑→↓]/i],
  ["WASD", /w[ ,/|·–-]*a[ ,/|·–-]*s[ ,/|·–-]*d/i],
  ["Enter", /(?<![\w])enter(?![\w])/i],
  ["Space", /(?<![\w])space(?![\w])/i],
  ["Escape", /(?<![\w])esc(ape)?(?![\w])/i],
  ["P", /(?<![\w])p(?![\w])|keyp/i],
  ["M", /(?<![\w])m(?![\w])|keym/i],
  ["the mouse", /mouse|click/i],
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws every key BINDINGS gives an action, and names the mouse", async () => {
  h.reset();
  const posed = poseScreen(h, "howto");
  assertEqual(posed.screen, "howto", "the screen the frame is read on");

  const { calls } = await h.frameDraw();
  captureStill(h, "howto");

  const text = drawnText(calls).join("\n");
  for (const [name, pattern] of KEYS) {
    assertTrue(
      pattern.test(text),
      `the how-to screen named ${name} (specs/ui.md, howto)`,
    );
  }
});
