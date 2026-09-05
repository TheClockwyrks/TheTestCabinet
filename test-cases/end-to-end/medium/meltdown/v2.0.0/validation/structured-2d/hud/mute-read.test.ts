// hud/mute-read — the mute control reads plainly differently muted and unmuted,
// and its read changes on the frame the mute bit does.
//
// THE RULE. specs/hud.md, The wave controls: "The mute control reads plainly
// differently muted and unmuted, and its read changes on the frame the mute state
// does, whichever way it was changed."
//
// THE STATE IS DRIVEN THROUGH THE KEY, NOT THROUGH THE CONTROL. specs/controls.md
// binds `mute` to `KeyM` and makes it an action that "Toggles sound, from any
// screen", and the surface carries no operation that sets muting: `muted` is "the
// game's own copy of the runtime's bit, reached through the `mute` binding or the
// panel's mute control" (surface.ts). This point is about the READ, so it moves
// the bit by the key and looks at the control; that a press on the CONTROL
// toggles the bit is `controls.mute-control`'s requirement, and driving it that
// way here would make this point fail for a build whose control was dead but
// whose read was perfect.
//
// THE FRAME IS THE POINT OF USING `tapAction`. It presses the key, runs exactly
// the one frame that delivers its edge, and releases — so the picture read
// afterwards is the picture the frame the bit changed on left behind. A build
// that redrew its mute control a frame late would read the old state here.
//
// WHAT IS COMPARED, AND WHY IT IS COLOUR-FREE. specs/overview.md fixes no
// palette, so nothing here says what muted looks like: the control's own
// rectangle — the one the panel reports — is photographed on each side of the
// press and the two pictures are compared. A build may change the word, the icon,
// the fill or strike the control through; every one of those moves pixels, and a
// build that draws the two states alike moves none.
//
// NEITHER STATE IS ASSUMED TO BE THE FIRST. Nothing in the specifications fixes
// which way a build opens, so the point reads the bit off the snapshot on each
// side of the press and only requires that it moved.
//
// THE FLOOR IS EMPTY AND THE WORLD GATE IS SHUT, as `startRun` leaves it, so the
// one frame the press runs cannot move anything else into the control's
// rectangle.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertNotEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  tapAction,
  type Harness,
} from "../harness";
import { largestChange, pixelsOver } from "./panel";

/**
 * How far above the movement two unchanged frames show a reading must sit for
 * the control to count as having been drawn differently, out of the 441 a full
 * swing across the cube is.
 *
 * NOT A LEGIBILITY BAR. specs/overview.md gives the palette to the build, so no
 * figure here says how far apart the two states must read; how plainly they do
 * is what the reviewer's presentation rating judges. This is the tolerance on
 * the noise measurement itself: two frames of an animated build do not move by
 * exactly the same amount every pair, so a reading has to clear the measured
 * movement by a little rather than by nothing. Eight units is under two per cent
 * of the scale.
 */
const NOISE_MARGIN = 8;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the mute control apart on the frame the mute key flips the bit", async () => {
  startRun(h);
  await h.advance(1);

  const before = h.snapshot();
  const first = pixelsOver(h, before.controls.mute);
  await h.advance(1);
  const beforePixels = pixelsOver(h, before.controls.mute);
  const noise = largestChange(first, beforePixels);
  captureStill(h, before.muted ? "muted" : "unmuted");

  await tapAction(h, "mute");

  const after = h.snapshot();
  const afterPixels = pixelsOver(h, after.controls.mute);
  captureStill(h, after.muted ? "muted" : "unmuted");

  assertNotEqual(
    after.muted,
    before.muted,
    "precondition: the mute key moved the mute bit (specs/controls.md)",
  );
  assertGreaterThanOrEqual(
    largestChange(beforePixels, afterPixels),
    noise + NOISE_MARGIN,
    `the mute control to be drawn differently with the bit at ` +
      `${String(after.muted)} than at ${String(before.muted)}, on the frame ` +
      `it changed, past the ${noise} two frames with the bit unmoved showed ` +
      `(specs/hud.md)`,
  );
});
