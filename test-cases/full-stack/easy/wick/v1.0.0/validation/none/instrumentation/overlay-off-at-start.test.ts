// Wick — instrumentation/overlay-off-at-start: a freshly started build draws
// no debug overlay until the backtick key first shows it.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Diagnostics"):
// "it is off when the game starts". The overlay's medium is the build's, so
// what it shows is read as text: with the overlay off at the start, the FIRST
// press of the key can only add text to the readout, and takes none away; a
// build that started with it on would have the first press remove it.
//
// WHY THE WORLD IS POSED AS IT IS. A fresh harness on the title the build
// opened on, with nothing pressed before the reading; the still is taken
// before the key is touched, so it shows the boot as the player sees it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  addedText,
  captureStill,
  createHarness,
  pressOverlayToggle,
  readout,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws no overlay until the key first shows it", async () => {
  await h.step(1);
  const fresh = await readout(h);
  await captureStill(h, "fresh");

  await pressOverlayToggle(h);
  const shown = await readout(h);
  assertEqual(
    addedText(shown, fresh).length,
    0,
    "text the first press took away",
  );
  assertGreaterThan(
    addedText(fresh, shown).length,
    0,
    "text the first press added",
  );
});
