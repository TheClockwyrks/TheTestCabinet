// hud/mute-read — the mute control reads plainly differently muted and unmuted,
// and its read changes on the frame the mute bit does.
//
// `specs/hud.md`, The wave controls: "The mute control reads plainly differently
// muted and unmuted, and its read changes on the frame the mute state does,
// whichever way it was changed."
//
// THE STATE IS DRIVEN THROUGH THE KEY, NOT THROUGH THE CONTROL. `specs/controls.md`
// binds `mute` to `KeyM`, and `specs/instrumentation.md` is explicit that there is
// no operation that sets muting: "`mute` is reached the way a player reaches it".
// This point is about the READ, so it moves the bit by the key and looks at the
// control; that a press on the CONTROL toggles the bit is
// `controls.mute-control`'s requirement, and driving it that way here would make
// this point fail for a build whose control was dead but whose read was perfect.
//
// THE FRAME IS THE POINT OF USING `tap`. It presses the key, runs exactly the one
// frame that delivers it, and releases — so the picture read afterwards is the
// picture the frame the bit changed on left behind. A build that redrew its mute
// control a frame late would read the old state here.
//
// WHAT IS DECIDED, AND WHERE THE BAR COMES FROM. `specs/overview.md` fixes no
// palette, so nothing here says what muted looks like and nothing says how far
// the two states must sit apart — that is the reviewer's. The control's own
// rectangle — the one the panel reports (`specs/instrumentation.md`) — is
// photographed on each side of the press and the two pictures are compared. A
// build may change the word, the icon, the fill or strike the control through;
// every one of those moves pixels, and a build that draws the two states alike
// moves none. How far the rectangle moves on its own is measured first, by
// photographing it twice with the bit unchanged, and the press has to beat that
// by `NOISE_MARGIN`.
//
// NEITHER STATE IS ASSUMED TO BE THE FIRST. Nothing in the specifications fixes
// which way a build opens, and `reset` leaves the bit "exactly as it stands,
// because muting is a player preference the runtime owns", so the point reads the
// bit off the snapshot on each side of the press and only requires that it moved.
//
// THE FLOOR IS EMPTY AND THE WORLD GATE IS SHUT, as `startRun` leaves it, so the
// one frame the press runs cannot move anything else into the control's rectangle.

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

afterEach(async () => {
  await h?.dispose();
});

it("draws the mute control apart on the frame the mute key flips the bit", async () => {
  await startRun(h);
  await h.advance(1);

  const before = await h.snapshot();
  const first = await pixelsOver(h, before.controls.mute);
  await h.advance(1);
  const beforePixels = await pixelsOver(h, before.controls.mute);
  const noise = largestChange(first, beforePixels);
  await captureStill(h, before.muted ? "muted" : "unmuted");

  await tapAction(h, "mute");

  const after = await h.snapshot();
  const afterPixels = await pixelsOver(h, after.controls.mute);
  await captureStill(h, after.muted ? "muted" : "unmuted");

  assertNotEqual(
    after.muted,
    before.muted,
    "precondition: the mute key moved the mute bit (specs/controls.md)",
  );
  assertGreaterThanOrEqual(
    largestChange(beforePixels, afterPixels),
    noise + NOISE_MARGIN,
    `the mute control to be drawn differently with the bit at ${String(after.muted)} than at ${String(before.muted)}, on the frame it changed, past the ${noise} two frames with the bit unmoved showed`,
  );
});
