// Meltdown — controls/mute-control: the panel's mute control toggles mute.
//
// THE RULE. specs/hud.md gives the control: "The panel carries... a mute control.
// The mute control reads plainly differently muted and unmuted, and its read
// changes on the frame the mute state does, whichever way it was changed."
// specs/controls.md answers a press and release inside a panel control as "That
// control is operated", and gives `mute` the effect "Toggles sound, from any
// screen." specs/instrumentation.md makes the bit readable and says why this point
// has to reach through the real control: "No operation sets it; the `mute` action
// and the panel's mute control do."
//
// TWO TAPS, BECAUSE THE REQUIREMENT IS A TOGGLE. One tap decides only that
// something moved; the second separates a toggle from a build that latches mute on
// and never lets it go. The item's own description names both halves.
//
// THE OPENING BIT IS READ, NOT ASSUMED. Nothing in the specifications fixes which
// way the bit stands when a game opens, and specs/instrumentation.md's `reset`
// leaves `muted` "exactly as it stands, because muting is a player preference the
// runtime owns". So both readings are relative to whatever the build opened on.
//
// A FRAME RUNS BETWEEN EACH TAP AND ITS READING. The snapshot's `muted` is the
// game's COPY of the runtime's bit, "refreshed in every update" and explicitly
// "not read at the call" (specs/instrumentation.md), so only a frame that has run
// past the tap can be read whichever order the build refreshes in.
//
// THE RECTANGLE IS RE-READ BETWEEN THE TWO TAPS, because specs/hud.md has the
// control "read plainly differently muted and unmuted" — its contents change
// between the taps, and a build is free to lay it out around them.
//
// THE CONTROL AND THE KEY ARE SEPARATE POINTS. specs/controls.md requires that
// "Every interaction and every menu is reachable with the pointer alone";
// `controls.mute-key` reads the key. That the control's READ changes with the bit
// is `hud.mute-read`, and that mute actually silences the cues is
// `audio.mute-silences`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  clickControl,
  createHarness,
  startRun,
  type Harness,
} from "../harness";

/**
 * Frames run after each tap before the bit is read back.
 *
 * `clickControl` ends with the frame the release resolves on; this is the frame
 * after it, so the game's mirrored copy has been refreshed by an update that began
 * after the release (specs/instrumentation.md).
 */
const MIRROR_TICKS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("flips the muted bit on a tap of the reported mute rectangle and flips it back on the next", async () => {
  startRun(h);
  await h.advance(1);
  const before = h.snapshot();
  const opened = before.muted;

  await clickControl(h, before.controls.mute);
  await h.advance(MIRROR_TICKS);
  captureStill(h, "muted");
  const once = h.snapshot();

  await clickControl(h, once.controls.mute);
  await h.advance(MIRROR_TICKS);
  const twice = h.snapshot();

  assertEqual(
    once.muted,
    !opened,
    "the muted bit after one press and release inside the reported mute " +
      `rectangle, from a game that opened at ${String(opened)} ` +
      "(specs/hud.md, specs/controls.md)",
  );
  assertEqual(
    twice.muted,
    opened,
    "the muted bit after a second press and release inside the reported mute " +
      "rectangle, back where it started — the control is a toggle " +
      "(specs/controls.md)",
  );
});
