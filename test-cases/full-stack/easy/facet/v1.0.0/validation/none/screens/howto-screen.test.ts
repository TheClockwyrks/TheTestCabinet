// Facet — screens/howto-screen: HOW TO PLAY reaches the how-to screen, and that
// screen names the keys a player needs to get back out of it.
//
// specs/ui.md gives `HOW TO PLAY` one effect — "Sets `screen = howto`" — and
// then lists what that screen covers. Most of that list is prose about the
// rules, which no check can decide without grading a build's writing. One line
// of it is not prose: "the controls, naming the keys bound to the `pause`,
// `mute`, and `back` actions". Those three keys are the ones a player cannot
// discover by pressing arrows at the board, so a how-to that omits them leaves
// the player stuck on the screen that was meant to help.
//
// WHAT COUNTS AS NAMING A KEY. specs/controls.md binds `pause` to `KeyP`,
// `mute` to `KeyM` and `back` to `Escape`, every key being a
// `KeyboardEvent.code` so a binding is a physical key. specs/ui.md fixes that
// the screen names those keys and fixes no spelling at all for how a key is
// written on a screen — no font, no layout, no wording — so both the letter on
// the key cap and the code that identifies it answer, case-insensitively. The
// match is on a WORD BOUNDARY rather than on a bare substring, which is what
// stops `PLAY` from answering for `P` and `HOW TO PLAY` from answering for `M`.
//
// A build is read whichever way it drew the copy: a piece that is the spelling
// by itself, a phrase carrying it, or the frame's pieces joined in draw order,
// so a line drawn one word or one glyph per call reads like any other.
//
// THE POSE IS THE ROUTE. specs/instrumentation.md defines `openHowTo()` as the
// choice of `HOW TO PLAY` from the title menu, "exactly as choosing that item
// does". This point is about the screen that choice reaches and the copy it
// draws, so nothing in it depends on where `HOW TO PLAY` sits in the menu.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { BINDINGS, type ActionName } from "../constants";
import {
  captureStill,
  createHarness,
  type Harness,
} from "../harness";

/**
 * The three actions specs/ui.md requires the how-to screen to name, and the
 * spellings that count as naming each one's key.
 *
 * Two per action: the `KeyboardEvent.code` specs/controls.md binds, and the
 * legend on the physical key that code identifies. The pairing is checked
 * against specs/controls.md's own table below rather than trusted, so this can
 * never end up asking for a key nothing is bound to.
 */
const NAMED: readonly { action: ActionName; spellings: readonly string[] }[] = [
  { action: "pause", spellings: ["P", "KeyP"] },
  { action: "mute", spellings: ["M", "KeyM"] },
  { action: "back", spellings: ["ESC", "Escape"] },
];

let h: Harness;

/**
 * Whether `token` stands as a word of its own among the copy a frame drew.
 *
 * Four readings, and the boundary is what makes them safe. A spelling is looked
 * for in each drawn piece, then in the pieces joined by a space and joined by
 * nothing, so a build that drew a line in one call, one call per word, or one
 * call per glyph is read the same way. A spelling of four characters or more —
 * `KeyP`, `KeyM`, `Escape` — is also read as a plain run of letters inside the
 * joined pieces, because a build that draws every glyph separately leaves no
 * boundary anywhere in that run; the one- and three-character spellings keep
 * the boundary, which is what stops `PLAY` from answering for `P`.
 *
 * Every spelling is alphanumeric, so it goes into the pattern as it stands.
 */
function namesKey(pieces: readonly string[], token: string): boolean {
  const word = new RegExp(`(?<![0-9A-Za-z])${token}(?![0-9A-Za-z])`, "iu");
  if (pieces.some((piece) => word.test(piece))) return true;
  if (word.test(pieces.join(" "))) return true;
  if (word.test(pieces.join(""))) return true;
  if (token.length < 4) return false;
  return pieces.join("").toLowerCase().includes(token.toLowerCase());
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the how-to screen, which names the pause, mute and back keys", async () => {
  // The fixture is tied to specs/controls.md's table rather than written beside
  // it: every key each action is bound to is among the spellings asked for, so
  // the check cannot come to name a key that fires nothing.
  for (const { action, spellings } of NAMED) {
    for (const code of BINDINGS[action]) {
      assertEqual(spellings.includes(code), true, `a spelling of ${code}`);
    }
  }

  await h.debug.reset();
  await h.debug.openHowTo();

  const opened = await h.snapshot();
  assertEqual(opened.screen, "howto", "the screen HOW TO PLAY reaches");
  assertEqual(opened.menuIndex, 0, "the highlight on a screen with no menu");

  // One frame, and everything it put on screen. The still is that same frame.
  const drawn = await h.frameText();
  await captureStill(h, "howto");

  for (const { action, spellings } of NAMED) {
    if (spellings.some((spelling) => namesKey(drawn, spelling))) continue;
    fail(
      `the how-to screen to name the key bound to the ${action} action, ` +
        `written as one of ${spellings.join(" or ")}`,
      drawn,
    );
  }
});
