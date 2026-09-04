// screens/howto-names-the-keys — the how-to screen names the controls.
//
// THE REQUIREMENT. `specs/ui.md`, of `howto`, lists what the screen covers and
// ends the list with "the controls, naming each key bound in
// `specs/controls.md`." `BINDINGS` is that list of keys, and the point of naming
// them on a screen of its own is that a player reads the controls without leaving
// it — this game binds seventeen actions, and none of them is discoverable by
// pressing at random.
//
// HOW IT IS DECIDED. The how-to screen is opened directly, through the operation
// that reaches a screen "exactly as reaching it in play does", so a build with a
// broken title menu still has this point decided on its own terms. The frame's own
// text draws are then read for each bound key.
//
// HOW A KEY IS RECOGNISED. `specs/ui.md` asks the screen to be written "in a
// player's words rather than as rules of a system", so a build is not going to
// print `KeyB` or `ArrowUp` on it, and a check that demanded the DOM code would
// fail every screen written the way the specification asks for. Each key is
// therefore matched against the ways a player's screen names it: a letter key by
// its letter as a word of its own, and the named keys by their common words or
// their glyphs. Casing, ordering, and every other word on the screen are the
// build's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertMatches } from "../assert";
import { ACTIONS, BINDINGS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { frameText } from "./reading";

/** How a player's screen may name each key that is not a plain letter. */
const NAMED: Readonly<Record<string, RegExp>> = {
  Space: /\bSPACE(BAR)?\b|␣/,
  ShiftLeft: /\bSHIFT\b|⇧/,
  ShiftRight: /\bSHIFT\b|⇧/,
  ArrowUp: /\bARROWS?\b|\bUP\b|[↑▲]/,
  ArrowDown: /\bARROWS?\b|\bDOWN\b|[↓▼]/,
  Enter: /\bENTER\b|\bRETURN\b|⏎|↵/,
  Escape: /\bESC(APE)?\b|⎋/,
};

/** The pattern a screen written in a player's words satisfies for `code`. */
function named(code: string): RegExp {
  const letter = /^Key([A-Z])$/.exec(code);
  return letter !== null ? new RegExp(`\\b${letter[1]}\\b`) : NAMED[code]!;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("names every key the game binds", async () => {
  await h.debug.reset();
  await h.debug.setScreen("howto");
  const calls = await h.frameCalls();
  await captureStill(h, "howto");

  assertEqual(
    (await h.snapshot()).screen,
    "howto",
    "the how-to screen showing (specs/ui.md)",
  );

  const text = frameText(calls);
  for (const action of ACTIONS) {
    // One key per action is enough: `modify` is the only action with two, and
    // they are the two Shifts, which a screen names once.
    const code = BINDINGS[action][0]!;
    assertMatches(
      text,
      named(code),
      `the how-to screen to name the key bound to \`${action}\`, ${code}, in a ` +
        "player's words (specs/ui.md, specs/controls.md)",
    );
  }
});
