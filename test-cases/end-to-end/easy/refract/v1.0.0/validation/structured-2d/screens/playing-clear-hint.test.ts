// Refract — screens/playing-clear-hint: a text draw on the playing frame names
// the key bound to the clear action as a standalone R.
//
// specs/ui.md's playing-screen table requires "the clear control: the key
// bound to the `clear` action, named on screen", and specs/controls.md binds
// `clear` to `KeyR` — so somewhere in the playing frame's text the letter R
// stands alone. The match is a word boundary on both sides, so a run that
// merely contains an R inside a word (BOARD, TIER, SCORE) cannot satisfy it,
// while any phrasing that names the key — "R", "R: clear", "[R] CLEAR" —
// does. How the hint is worded and where it sits is the build's; that it sits
// clear of the board is presentation/readouts-clear-of-the-board's point, not
// this one's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { GEO_3X3 } from "../fixtures";
import {
  captureStill,
  createHarness,
  drawnText,
  loadBoard,
  resetTo,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("names the clear key as a standalone R on the playing frame", async () => {
  await resetTo(h);
  await loadBoard(h, GEO_3X3);
  assertEqual(h.snapshot().screen, "playing", "the playing screen is up");

  // One whole frame's draws, recorded from a clean log.
  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "playing");

  const texts = drawnText(h.calls);
  assertGreaterThan(texts.length, 0, "the playing frame draws text");
  assertEqual(
    texts.some((text) => /\bR\b/.test(text)),
    true,
    "a drawn run names the clear key as a standalone R",
  );
});
