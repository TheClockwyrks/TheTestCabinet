// Facet — keyboard/mute-key-flips: the `mute` action, fired with the key
// specs/controls.md binds it to, flips the mute bit.
//
// WHAT IS BEING READ, AND WHY IT IS READABLE AT ALL. The bit itself belongs to
// the runtime — specs/ui.md: "Muting and the first-interaction unlock belong to
// the runtime. The game binds the `mute` action to the runtime's mute bit and
// toggles it from any screen, then mirrors that bit into `state.muted` every
// frame." So the snapshot's `muted` is the game's own report of the runtime bit,
// and a check reads the binding and the mirror together through it: a build that
// never bound the key leaves the flag where it was, and one that toggled a flag
// of its own without reaching the runtime is not distinguishable from here — the
// specification puts the bit somewhere a check cannot see, and the mirror is
// what it makes observable.
//
// Nothing is asserted against a fixed value — the specification never says which
// way the bit rests when a round opens — only against the reading taken before
// the press.
//
// A frame is advanced after each press because the mirror is stated per frame:
// the value read is one the game has actually reported, not one caught
// mid-press.
//
// THE SECOND PRESS IS ITS OWN POINT. specs/controls.md's effect table says
// `mute` "Toggles the runtime's mute bit", and a build that only ever mutes
// gives a player no way back to sound while passing any check that pressed the
// key once. That half is `keyboard/mute-key-flips-back`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { quietRowsWithEscape } from "../board";
import { BINDINGS } from "../constants";
import {
  captureStill,
  createHarness,
  loadBoard,
  type Harness,
} from "../harness";

let h: Harness;

/** The one key specs/controls.md binds the `mute` action to. */
const MUTE_KEY = BINDINGS.mute[0];

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it(`flips muted on ${MUTE_KEY}`, async () => {
  // A posed board, so the presses are read on a live `playing` screen rather
  // than on whichever screen a build happens to open on.
  loadBoard(h, quietRowsWithEscape([]));

  // Whatever the bit rests at is the baseline: the specification fixes the
  // toggle, not the resting value.
  const resting = h.snapshot().muted;
  assertEqual(typeof resting, "boolean", "the type of the mirrored mute bit");

  // A real press of the bound key, then a frame — the mirror is per frame.
  await h.tap(MUTE_KEY);
  await h.advance(1);

  // The frame past the press, which is the first frame drawn with the bit
  // flipped — so whatever the build shows for sound being off is on it.
  captureStill(h, "mute");

  assertEqual(h.snapshot().muted, !resting, `muted after one ${MUTE_KEY}`);
});
