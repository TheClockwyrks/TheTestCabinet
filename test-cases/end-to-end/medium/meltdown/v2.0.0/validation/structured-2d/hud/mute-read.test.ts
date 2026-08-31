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
import { differing, pixelsOver } from "./panel";

/**
 * The RGB distance, out of the 441 a full swing across the cube is, at which two
 * colours count as plainly apart.
 *
 * The same figure `hud/shop-disabled-when-unaffordable` uses, and for the same
 * reason: specs/overview.md fixes no colours and asks that a state read at a
 * glance, so `60` — roughly an eighth of the cube's diagonal — is past any
 * anti-aliasing wobble and well under the swing between a lit and a dimmed run of
 * text.
 */
const PLAINLY = 60;

/**
 * How many of the control's pixels must move that far: forty.
 *
 * About the ink of one small glyph, so less than any change of the control's word
 * or mark can amount to, and far more than the zero a static panel moves on its
 * own.
 */
const MOVED = 40;

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
  const beforePixels = pixelsOver(h, before.controls.mute);
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
    differing(beforePixels, afterPixels, PLAINLY),
    MOVED,
    `the mute control to read plainly differently with the bit at ` +
      `${String(after.muted)} than at ${String(before.muted)}, on the frame ` +
      `it changed (specs/hud.md)`,
  );
});
