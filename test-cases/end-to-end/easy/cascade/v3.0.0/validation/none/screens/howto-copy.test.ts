// screens/howto-copy — the how-to screen carries the four tokens the
// specification fixes, each as a standalone word.
//
// `specs/screens.md`, the `howto` screen: it covers the goal, how a column
// builds, what the stock does, and how a card is moved and sent home — and then,
// binding whatever wording a build chooses, "Whatever wording it uses, the screen
// carries each of these four tokens as a standalone word: `ACE`, `KING`, `STOCK`,
// and `DOUBLE-CLICK`."
//
// ONE ITEM, NOT FOUR, AND NOT ZERO. The requirement is one screen's copy, so it
// is one point. What a script can decide is the part the specification made
// mechanical: that each of the four tokens is among the runs of text the frame
// drew. Whether the prose around them actually teaches the game is a reviewer's
// judgement, made from the captured frame, and a check must not pretend to make
// it.
//
// AT WORD BOUNDARIES, WHICH IS THE WHOLE POINT OF `drewWord`. A screen reading
// "restocking the pile" contains `stock` and names no pile; a screen reading
// "PLACE" contains `ACE` and names no rank. The looser `drewText` would pass both.
// Matching ignores case, because the casing a build draws its prose in is the
// build's; `DOUBLE-CLICK` keeps its hyphen, which is not a word character, so the
// boundary rule holds around it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { HOWTO_TOKENS } from "../constants";
import {
  captureStill,
  createHarness,
  drawnText,
  drewWord,
  openHowto,
  type Harness,
} from "../harness";

/** A screen that drew no text at all cannot carry the copy (`specs/screens.md`). */
const MIN_RUNS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws each of the four fixed tokens as a standalone word", async () => {
  await openHowto(h);

  const calls = await h.frameCalls();
  await captureStill(h, "howto");

  assertGreaterThanOrEqual(
    drawnText(calls).length,
    MIN_RUNS,
    "the runs of text the how-to screen drew (specs/screens.md)",
  );
  for (const token of HOWTO_TOKENS) {
    assertEqual(
      drewWord(calls, token),
      true,
      `the how-to screen carries "${token}" as a standalone word (specs/screens.md)`,
    );
  }
});
