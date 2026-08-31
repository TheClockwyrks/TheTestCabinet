// Meltdown — controls/mute-control: the panel's mute control toggles mute.
//
// specs/hud.md gives the control: "The panel carries... a mute control. The mute
// control reads plainly differently muted and unmuted, and its read changes on the
// frame the mute state does, whichever way it was changed." specs/controls.md answers
// a press and release inside a panel control as "That control is operated", and gives
// `mute` the effect "Toggles sound, from any screen." specs/instrumentation.md makes
// the bit readable and says why this point has to reach through the real control:
// "No operation sets it; the `mute` action and the panel's mute control do."
//
// TWO TAPS, BECAUSE THE REQUIREMENT IS A TOGGLE. One tap decides only that something
// moved; the second separates a toggle from a build that latches mute on and never
// lets it go. The item's own description names both halves.
//
// THE OPENING BIT IS READ, NOT ASSUMED. Nothing in the specifications fixes which way
// the bit stands when a game opens, and specs/instrumentation.md's `reset` leaves
// `muted` "exactly as it stands, because muting is a player preference the runtime
// owns". So both readings are relative to whatever the build opened on.
//
// AUDIO IS ARMED FIRST, with a genuine browser gesture on `UNBOUND_KEY` — a key
// specs/controls.md binds to nothing. Under this engine the whole audio layer is the
// build's and specs/audio.md forbids it playing anything before the first
// interaction, so a build free to create its bus and its mute bit on the first real
// gesture must be given one; a posed pointer event is not that gesture.
//
// THE RECTANGLE IS RE-READ BETWEEN THE TWO TAPS, because specs/hud.md has the control
// "read plainly differently muted and unmuted" — its contents change between the
// taps, and a build is free to lay it out around them.
//
// THE CONTROL AND THE KEY ARE SEPARATE POINTS. specs/controls.md requires that
// "Every interaction and every menu is reachable with the pointer alone";
// `controls.mute-key` reads the key. That the control's READ changes with the bit is
// `hud.mute-read`, and that mute actually silences the cues is `audio.mute-silences`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  tapControl,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("flips the muted bit on a tap of the reported mute rectangle and flips it back on the next", async () => {
  await startRun(h);
  await h.armAudio();
  await h.advance(1);
  const before = await h.snapshot();
  const opened = before.muted;

  await tapControl(h, before.controls.mute);
  const once = await h.snapshot();
  await captureStill(h, "muted");

  await tapControl(h, once.controls.mute);
  const twice = await h.snapshot();

  assertEqual(
    once.muted,
    !opened,
    `the muted bit after one press and release inside the reported mute rectangle, from a game that opened at ${String(opened)}`,
  );
  assertEqual(
    twice.muted,
    opened,
    "the muted bit after a second press and release inside the reported mute rectangle, back where it started",
  );
});
