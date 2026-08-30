// screens/howto-copy — the how-to screen carries the four tokens the
// specification fixes for it.
//
// THE RULE. specs/screens.md's `howto` section describes what the screen covers —
// the goal of building the foundations from Ace to King, how a column builds and
// what fills an empty one, the stock and its recycle, and how a card is moved and
// sent home — and then fixes what is mechanically decidable about that prose:
// "Whatever wording it uses, the screen carries each of these four tokens as a
// standalone word: `ACE`, `KING`, `STOCK`, and `DOUBLE-CLICK`."
//
// ONE POINT, FOUR TOKENS. The requirement is one — the how-to screen carries the
// copy the specification fixes — so it is decided once, and a build missing a
// token fails naming the token it is missing. A script can decide whether a word
// is drawn; it cannot decide whether wording NAMES the goal, and
// `.claude/skills/test-cases/SKILL.md` forbids asking it to. The prose around the
// four tokens is the reviewer's to read from the captured frame, which is what the
// still beside this verdict is for.
//
// MATCHED AT WORD BOUNDARIES ({@link drewToken}), because the specification asks
// for each token "as a standalone word": the ACE inside PLACE and the KING inside
// KINGDOM are not the words it asked for, and a substring match would take them.
// Case is ignored, because how the copy is cased is the build's.
//
// THE SCREEN IS POSED DIRECTLY with `setScreen("howto")`, which changes nothing
// else (specs/instrumentation.md). Reaching it through the title screen's control
// instead would fold `screens/title-how-to-opens`'s requirement into this verdict.
// `clearTable` empties the piles beneath, so every run of text the frame draws
// belongs to the screen rather than to a card's rank.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  drawFrame,
  drewToken,
  type Harness,
} from "../harness";

/**
 * The four standalone tokens specs/screens.md fixes for the how-to screen.
 *
 * The literals are the specification's own, restated here because they are copy
 * rather than a figure and `src/constants.ts` carries no constant for them.
 */
const TOKENS = ["ACE", "KING", "STOCK", "DOUBLE-CLICK"] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws each of the four standalone tokens among the how-to screen's text", async () => {
  h.debug.setScreen("howto");
  h.debug.clearTable();
  assertEqual(
    h.snapshot().screen,
    "howto",
    "posing: the game is on the how-to screen the frame below draws " +
      "(specs/instrumentation.md)",
  );

  const calls = await drawFrame(h);
  captureStill(h, "howto");

  for (const token of TOKENS) {
    assertEqual(
      drewToken(calls, token),
      true,
      `the how-to screen's frame drawing ${token} as a standalone word ` +
        "(specs/screens.md)",
    );
  }
});
