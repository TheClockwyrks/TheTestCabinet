// Wick — instrumentation/overlay-hidden-on-second-toggle: pressing the backtick
// key a second time hides the debug overlay again.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Diagnostics"):
// "the backtick key (`KeyboardEvent.code` `Backquote`) shows and hides it";
// specs/controls.md: "The diagnostics overlay toggles on `Backquote`, outside
// the action registry." The overlay's medium is the build's, so what it shows
// is read as text, and "hidden" is the readout back to what it was on the frame
// before any press. Showing it is `instrumentation/overlay-shown-on-toggle`'s,
// and this point makes no claim about it: the first press is only the route to
// the state the second press must undo.
//
// WHY THE WORLD IS POSED AS IT IS. A paused run, so every frame draws the same
// picture and the only thing that can change the readout between two frames
// is the overlay.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
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

it("hides the overlay on the second Backquote", async () => {
  await isolate(h);
  await poseScreen(h, "paused");
  await h.step(1);
  const hidden = await readout(h);

  await pressOverlayToggle(h);
  await pressOverlayToggle(h);
  const again = await readout(h);
  await captureStill(h, "hidden");

  assertEqual(
    sameReadout(again, hidden),
    true,
    "the readout back to the hidden one after the second press",
  );
});
