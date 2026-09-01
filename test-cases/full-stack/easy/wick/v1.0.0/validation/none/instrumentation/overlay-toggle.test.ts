// Wick — instrumentation/overlay-toggle: pressing the backtick key shows the
// debug overlay, and pressing it again hides it.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Diagnostics"):
// "the backtick key (`KeyboardEvent.code` `Backquote`) shows and hides it";
// specs/controls.md: "The diagnostics overlay toggles on `Backquote`, outside
// the action registry." The overlay's medium is the build's, so what it shows
// is read as text, and "shown" is the readout gaining text over the frame
// before the press while "hidden" is the readout back to what it was.
//
// WHY THE WORLD IS POSED AS IT IS. A paused run, so every frame draws the same
// picture and the only thing that can change the readout between two frames
// is the overlay.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  addedText,
  captureStill,
  createHarness,
  isolate,
  poseScreen,
  pressOverlayToggle,
  readout,
  sameReadout,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows the overlay on Backquote and hides it on the next", async () => {
  await isolate(h);
  await poseScreen(h, "paused");
  await h.step(1);
  const hidden = await readout(h);

  await pressOverlayToggle(h);
  const shown = await readout(h);
  await captureStill(h, "shown");
  assertGreaterThan(
    addedText(hidden, shown).length,
    0,
    "text the overlay added when shown",
  );

  await pressOverlayToggle(h);
  const again = await readout(h);
  assertEqual(
    sameReadout(again, hidden),
    true,
    "the readout back to the hidden one after the second press",
  );
});
