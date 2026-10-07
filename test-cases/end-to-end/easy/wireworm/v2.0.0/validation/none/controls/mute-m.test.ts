// Wireworm — controls/mute-m: KeyM reaches the mute action, and the action
// toggles.
//
// specs/controls.md binds `mute` to `KeyM` alone, says it "toggles sound, from any
// screen", and reads it as a press edge, "once per press". specs/ui.md states the
// bit it moves: under this engine "muting is yours as well, and the `mute` action
// toggles it from any screen". specs/instrumentation.md makes the bit readable —
// "`muted` is the game's copy of the runtime's mute bit, refreshed in every
// update, so the snapshot reports the bit the runtime holds" — and, in the same
// breath, states why this point has to reach through the real key: "No operation
// sets it; the `mute` action does." There is no `setMuted` to pose with.
//
// TWO PRESSES, BECAUSE THE REQUIREMENT IS A TOGGLE. One press decides only that
// something moved; the second is what separates a toggle from a build that latches
// mute on and never lets it go, and from one that mutes while the key is held.
// The item's own description names both halves.
//
// THE STARTING BIT IS READ, NOT ASSUMED. Neither specification fixes which way the
// bit stands when a game opens — and specs/instrumentation.md's `reset` "leaves
// `muted` exactly as it stands, because muting is a player preference the runtime
// owns" — so the readings below are relative to whatever the build opened on. A
// build that starts muted and one that starts unmuted are both conformant and both
// pass, and only a build whose key does not flip the bit fails.
//
// AUDIO IS ARMED FIRST, with `Harness.armAudio`'s genuine browser gesture on a key
// specs/controls.md binds to nothing. A build is free to build its whole audio
// layer, mute bit and all, on the first real interaction — specs/ui.md says "audio
// does not start until the player has interacted with the page" — and a check that
// never gave it one would grade that build on a layer it had not been allowed to
// create yet. The key touches no game state.
//
// THE WORLD IS AN EMPTY LIVE BOARD. `startPlaying` empties the four rosters and
// shuts the three world gates, so nothing on the board plays a cue, ends a level,
// or moves the game off `playing` while the two presses are read.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";

/** The key this point is about, the only one `mute` is bound to. */
const KEY = "KeyM";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("flips the muted bit on a KeyM press and flips it back on the next", async () => {
  await startPlaying(h);
  await h.armAudio();
  await h.advance(1);
  const opened = (await h.snapshot()).muted;

  await h.tap(KEY);
  await h.advance(1);
  const once = (await h.snapshot()).muted;
  await captureStill(h, "muted");

  await h.tap(KEY);
  await h.advance(1);
  const twice = (await h.snapshot()).muted;

  assertEqual(
    once,
    !opened,
    `the muted bit after one KeyM press, from a game that opened at ${String(opened)}`,
  );
  assertEqual(
    twice,
    opened,
    "the muted bit after a second KeyM press, back where it started",
  );
});
