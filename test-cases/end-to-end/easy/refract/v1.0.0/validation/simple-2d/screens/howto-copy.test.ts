// Refract — screens/howto-copy: the how-to screen draws text, and among the
// draws a standalone R names the key bound to the clear action.
//
// specs/ui.md's `howto` section requires the screen to explain the game and to
// name, among its points, the key bound to `clear` — which specs/controls.md
// fixes as KeyR. What is mechanically decidable is that the frame draws text
// at all and that some drawn run carries a standalone R, matched at word
// boundaries so the R inside REFRACT or CRYSTAL cannot stand in for it; the
// full rules prose is the reviewer's to read from the captured frame, which is
// why this item's cap is `great` rather than a functional one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
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

it("draws its copy, naming the clear key as a standalone R", async () => {
  await resetTo(h);
  await tapAction(h, "down");
  await tapAction(h, "down");
  await tapAction(h, "confirm");
  assertEqual(
    h.snapshot().screen,
    "howto",
    "posing: confirming HOW TO PLAY opens the how-to screen (specs/ui.md)",
  );

  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "howto");

  const texts = drawnText(h.calls);
  assertGreaterThan(
    texts.length,
    0,
    "the howto frame draws text explaining the game (specs/ui.md)",
  );
  assertTrue(
    texts.some((text) => /\bR\b/i.test(text)),
    "a standalone R among the drawn text names the key bound to the clear " +
      "action (KeyR, specs/controls.md; specs/ui.md: howto names it)",
  );
});
