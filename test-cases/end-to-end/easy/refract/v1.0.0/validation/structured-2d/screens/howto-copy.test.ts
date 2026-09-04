// Refract — screens/howto-copy: the how-to frame draws text, and among the
// draws a standalone R names the key bound to the clear action.
//
// specs/ui.md requires the how-to screen to cover the controls, "naming the
// key bound to the `clear` action", and specs/controls.md binds `clear` to
// `KeyR` — so somewhere in the frame's text the letter R stands alone. The
// match is a word boundary on both sides, so prose that merely contains an R
// inside a word (REFRACT, CRYSTAL, PRESS) cannot satisfy it, while any
// phrasing that names the key — "R", "press R", "R clears the board",
// "[R] CLEAR" — does. What the rest of the copy says is the build's own
// writing: whether the prose really teaches the game is the run-wide aesthetic
// rating's, not this point's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  drawnText,
  resetTo,
  tapAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws how-to text naming the clear key as a standalone R", async () => {
  // Reach the how-to screen the way a player does: down twice to HOW TO PLAY,
  // then confirm (specs/ui.md).
  await resetTo(h);
  assertEqual(TITLE_ITEMS[2], "HOW TO PLAY");
  await tapAction(h, "down");
  await tapAction(h, "down");
  await tapAction(h, "confirm");
  assertEqual(h.snapshot().screen, "howto", "the how-to screen is up");

  // One whole frame's draws, recorded from a clean log.
  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "howto");

  const texts = drawnText(h.calls);
  assertGreaterThan(texts.length, 0, "the how-to frame draws text");
  assertEqual(
    texts.some((text) => /\bR\b/.test(text)),
    true,
    "a drawn run names the clear key as a standalone R",
  );
});
