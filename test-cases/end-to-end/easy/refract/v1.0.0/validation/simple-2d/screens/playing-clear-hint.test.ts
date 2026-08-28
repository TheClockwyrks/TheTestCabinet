// Refract — screens/playing-clear-hint: the playing screen names the clear
// key.
//
// specs/ui.md's `playing` table lists the clear control among what the player
// sees: the key bound to the `clear` action, named on screen — and
// specs/controls.md fixes that binding as KeyR. What is mechanically decidable
// is that some text draw on the playing frame carries a standalone R, matched
// at word boundaries so the R inside REFRACT, CRYSTAL, or CLEAR itself cannot
// stand in for it; whether the surrounding copy reads well is the reviewer's,
// from the captured frame.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
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

it("a text draw on the playing frame names the clear key as a standalone R", async () => {
  await resetTo(h);
  await loadBoard(h, GEO_3X3);
  assertEqual(
    h.snapshot().screen,
    "playing",
    "posing: loadBoard moves to playing (specs/instrumentation.md)",
  );

  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "playing");

  assertTrue(
    drawnText(h.calls).some((text) => /\bR\b/i.test(text)),
    "a text draw on the playing frame names the key bound to the clear " +
      "action as a standalone R (specs/ui.md: the clear control; " +
      "specs/controls.md: clear is KeyR)",
  );
});
