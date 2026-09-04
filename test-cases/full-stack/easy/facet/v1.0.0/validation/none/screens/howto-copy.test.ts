// Facet — screens/howto-copy: the how-to screen tells a player what the game is
// worked with.
//
// specs/ui.md lists what the `howto` screen covers. Most of that list is prose about the
// rules, which no check can decide without grading a build's writing. Its last
// line is not prose: "the controls: that the board is played with a mouse, a
// pen, or a finger, and that the menus answer the pointer and the keys bound to
// the `up`, `down`, `confirm`, `pause`, `mute`, and `back` actions, each named
// by its key."
//
// That line is the whole of what a player cannot discover by trying things. The
// board answers no key at all, so a player who never reads that it is played
// with a pointer has nothing to press; and `pause`, `mute` and `back` are keys
// no menu shows, so a how-to that omits them leaves the player stuck on the very
// screen that was meant to help.
//
// WHAT COUNTS AS NAMING A KEY. specs/controls.md fixes the whole binding table —
// every key a `KeyboardEvent.code`, so a binding is a physical key rather than a
// layout-dependent character — and specs/ui.md fixes that the screen names those
// keys while fixing no spelling at all for how a key is written on a screen: no
// font, no layout, no wording. So both the legend on the key cap and the code
// that identifies it answer, case-insensitively, and for the two arrow keys the
// glyph on the cap answers as well. An action carrying two keys is named by
// either of them, because specs/controls.md says each key of a two-key action
// fires it on its own.
//
// The spellings are derived from BINDINGS rather than written beside it: each
// code the table binds carries its own spellings below, and the fixture fails if
// an action is bound to a key nothing here can spell. So this check can never
// come to ask for a key that fires nothing, and a change to the table shows up
// here as a fixture failure rather than as a build's.
//
// WHAT COUNTS AS NAMING THE POINTER. specs/ui.md asks the screen to say the
// board is played with a mouse, a pen, or a finger, and fixes no wording, so any
// one of those answers — as does naming the device rather than the digit, since
// a screen that says the board is played by touch has said the same thing. One
// of the four is enough; the screen is not required to list all three devices.
//
// THE MATCH IS ON A WORD BOUNDARY, which is what stops `PLAY` from answering for
// the `P` of `KeyP` and `HOW TO PLAY` from answering for the `M` of `KeyM`. A
// build is read whichever way it drew the copy: a piece that is the spelling by
// itself, a phrase carrying it, or the frame's pieces joined in draw order, so a
// line drawn one word or one glyph per call reads like any other.
//
// THE SCREEN IS POSED, NOT TAKEN INTO. That the title's `HOW TO PLAY` entry
// reaches this screen is `screens/howto-screen`'s point, and taking a menu item
// on the way here would only add that point's failure modes to this one.
// specs/instrumentation.md's `setScreen` shows the screen and changes nothing
// else, and "the screen behaves from there exactly as it does when a player
// reaches it".

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { type ActionName, ACTIONS, BINDINGS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";

/**
 * How each `KeyboardEvent.code` specs/controls.md binds may be written on a
 * screen.
 *
 * Two or three per key: the code itself, the legend on the physical key that
 * code identifies, and for the two arrows the glyph a build is as likely to draw
 * as the word. specs/ui.md fixes no spelling, so every one of them names that
 * key and any one of them answers.
 */
const SPELLINGS: Readonly<Record<string, readonly string[]>> = {
  ArrowUp: ["ArrowUp", "UP", "↑"],
  ArrowDown: ["ArrowDown", "DOWN", "↓"],
  Enter: ["Enter", "Return"],
  Space: ["Space"],
  Escape: ["Escape", "ESC"],
  KeyP: ["KeyP", "P"],
  KeyM: ["KeyM", "M"],
};

/**
 * The wordings that count as saying the board is played with a pointer.
 *
 * The three devices specs/ui.md names, and the name of the input itself, since a
 * build that writes "touchscreen" rather than "finger" has told the player the
 * same fact. `pen` is three characters and so keeps the word boundary below,
 * which is what stops it answering inside `open` or `happens`.
 */
const POINTER_WORDS: readonly string[] = ["mouse", "pen", "finger", "touch"];

let h: Harness;

/**
 * Whether `token` stands as a word of its own among the copy a frame drew.
 *
 * Four readings, and the boundary is what makes them safe. A spelling is looked
 * for in each drawn piece, then in the pieces joined by a space and joined by
 * nothing, so a build that drew a line in one call, one call per word, or one
 * call per glyph is read the same way. A spelling of four characters or more —
 * `KeyP`, `Escape`, `mouse` — is also read as a plain run of characters inside
 * the joined pieces, because a build that draws every glyph separately leaves no
 * boundary anywhere in that run, and because a longer word carries its own
 * meaning inside a compound like `touchscreen`. The one- and three-character
 * spellings keep the boundary, which is what stops `PLAY` from answering for
 * `P`.
 *
 * Every spelling is a letter, a digit or an arrow glyph, none of which carries
 * any meaning in a pattern, so each goes in as it stands.
 */
function namesToken(pieces: readonly string[], token: string): boolean {
  const word = new RegExp(`(?<![0-9A-Za-z])${token}(?![0-9A-Za-z])`, "iu");
  if (pieces.some((piece) => word.test(piece))) return true;
  if (word.test(pieces.join(" "))) return true;
  if (word.test(pieces.join(""))) return true;
  if (token.length < 4) return false;
  return pieces.join("").toLowerCase().includes(token.toLowerCase());
}

/** Every spelling that names any key bound to `action`. */
function spellingsFor(action: ActionName): string[] {
  return BINDINGS[action].flatMap((code) => {
    const spellings = SPELLINGS[code];
    if (spellings === undefined) {
      // A fixture fault, not a build's: specs/controls.md bound a key this
      // check has no way to look for, so it would be asking for nothing.
      fail(`a spelling for the ${code} key specs/controls.md binds`, code);
    }
    return [...spellings];
  });
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("names the pointer and the key of every action", async () => {
  // The fixture is tied to specs/controls.md's table rather than written beside
  // it: every action is asked about, and every key each one is bound to has a
  // spelling here, so the check cannot come to name a key that fires nothing.
  const wanted = ACTIONS.map((action) => ({
    action,
    spellings: spellingsFor(action),
  }));

  await h.debug.reset();
  await h.debug.setScreen("howto");

  // The fixture: the frame read below is the how-to screen's.
  assertEqual(
    (await h.snapshot()).screen,
    "howto",
    "the screen the pose reaches",
  );

  // One frame, and everything it put on screen. The still is that same frame.
  const drawn = await h.frameText();
  await captureStill(h, "howto");

  // The pointer the board is played with: any one of the four wordings.
  if (!POINTER_WORDS.some((word) => namesToken(drawn, word))) {
    fail(
      `the how-to screen to say the board is played with a pointer, ` +
        `written as one of ${POINTER_WORDS.join(" or ")}`,
      drawn,
    );
  }

  // And the key of each of the six actions, one action at a time so the
  // failure names which of them the screen left unsaid.
  for (const { action, spellings } of wanted) {
    if (spellings.some((spelling) => namesToken(drawn, spelling))) continue;
    fail(
      `the how-to screen to name the key bound to the ${action} action, ` +
        `written as one of ${spellings.join(" or ")}`,
      drawn,
    );
  }
});
