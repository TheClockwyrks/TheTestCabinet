// Meltdown — controls/rotate-key: R turns the held preview.
//
// THE RULE. `rotate` "turns the held preview one step" (specs/controls.md, The
// actions) and is bound to `KeyR` (The bindings). What one step is comes from
// specs/building.md, Rotating the preview: "rotating advances the held rotation
// one step through `0`, `1`, `2`, `3` and back to `0`". So four presses from a
// held rotation of `0` read `1`, `2`, `3`, `0`, and the fourth is the wrap the
// item names.
//
// WHY THE PREVIEW IS ARMED THROUGH THE SURFACE. Arming from the number keys is
// `controls.arm-hotkeys`'s requirement and arming from the shop is
// `controls.pointer-arms-from-the-shop`'s; a validator reaches its own scenario
// directly, so this one poses the held preview with `setArmed` and presses only
// the key it is about.
//
// The rotation is posed to `0` rather than assumed, so the four readings below
// are the four steps of the cycle wherever the build happened to leave it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";

/** The four steps `KeyR` walks from a held rotation of `0` (specs/building.md). */
const CYCLE = [1, 2, 3, 0] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("advances the held rotation a step at a time, and wraps from 3 to 0", async () => {
  startRun(h);
  h.debug.setArmed("arc");
  h.debug.setPreviewRotation(0);

  for (const expected of CYCLE) {
    await h.tap("KeyR");
    captureStill(h, "rotated");

    const held = h.snapshot().build;
    assertNotNull(held, "a placement is still held after R");
    assertEqual(held?.rotation, expected, "the held rotation after R");
  }
});
