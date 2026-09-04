// screens/howto-copy — the how-to screen names the goal and the controls.
//
// specs/screens.md fixes what the how-to screen has to cover — the goal of
// building the foundations Ace to King, how a column builds and what fills an
// empty one, the stock and its recycle, and how a card is moved and sent home —
// and then fixes the part a script can decide: "Whatever wording it uses, the
// screen carries each of these four tokens as a standalone word: `ACE`, `KING`,
// `STOCK`, and `DOUBLE-CLICK`."
//
// THOSE FOUR TOKENS ARE THE WHOLE OF WHAT IS ASSERTED. Whether the prose around
// them "names the goal" is not a question a script can answer, so the frame is
// captured as an image and that reading is left to the reviewer.
//
// EACH IS MATCHED AT WORD BOUNDARIES, so prose that merely carries the letters
// inside a longer word cannot satisfy it — PLACE does not name the ACE, and
// STOCKING does not name the STOCK — while any phrasing that uses the word does:
// "up to the KING", "off the STOCK onto the waste", "DOUBLE-CLICK a card". Case
// is ignored, because which case a build sets its copy in is its own typography.
//
// THE SCREEN IS POSED WITH `setScreen`, so a build that draws the right copy
// behind a broken menu fails `screens/title-how-to-opens` alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertMatches } from "../assert";
import {
  captureStill,
  createHarness,
  drawnText,
  resetTo,
  type Harness,
} from "../harness";
import { HOWTO_TOKENS } from "../constants";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("names ACE, KING, STOCK and DOUBLE-CLICK as standalone words", async () => {
  resetTo(h);
  h.debug.setScreen("howto");
  assertEqual(
    h.snapshot().screen,
    "howto",
    "posing: setScreen puts the how-to screen up, which is the screen this " +
      "point reads (specs/instrumentation.md)",
  );

  const calls = await h.drawFrame();
  captureStill(h, "howto");

  const runs = drawnText(calls);
  assertGreaterThan(
    runs.length,
    0,
    "runs of text on the how-to screen, which is where its copy has to be " +
      "(specs/screens.md)",
  );

  const copy = runs.join("  ");
  for (const token of HOWTO_TOKENS) {
    assertMatches(
      copy,
      new RegExp(`\\b${token}\\b`, "i"),
      `the how-to screen's copy to carry ${token} as a standalone word ` +
        "(specs/screens.md)",
    );
  }
});
