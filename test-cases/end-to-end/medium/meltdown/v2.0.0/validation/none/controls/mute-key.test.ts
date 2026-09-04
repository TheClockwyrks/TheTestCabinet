// Meltdown — controls/mute-key: KeyM toggles mute, and toggles it back.
//
// specs/controls.md binds `mute` to `KeyM` and gives it the effect "Toggles sound,
// from any screen." specs/instrumentation.md makes the bit readable and, in the
// same breath, says why this point has to reach through the real key: "`muted` is
// the game's copy of the runtime's mute bit, refreshed in every update... No
// operation sets it; the `mute` action and the panel's mute control do." There is
// no `setMuted` to pose with.
//
// TWO PRESSES, BECAUSE THE REQUIREMENT IS A TOGGLE. One press decides only that
// something moved; the second separates a toggle from a build that latches mute on
// and never lets it go, and from one that silences the game only while the key is
// held. The item's own description names both halves — "moves `muted` between true
// and false".
//
// THE OPENING BIT IS READ, NOT ASSUMED. Nothing in the specifications fixes which
// way the bit stands when a game opens, and specs/instrumentation.md's `reset`
// leaves `muted` "exactly as it stands, because muting is a player preference the
// runtime owns". So both readings below are relative to whatever the build opened
// on: a build that starts muted and one that starts unmuted are both conformant
// and both pass, and only a build whose key does not flip the bit fails.
//
// AUDIO IS ARMED FIRST, with a genuine browser gesture on `UNBOUND_KEY` — a key
// specs/controls.md binds to nothing, so it changes no game state and toggles no
// overlay. Under this engine the whole audio layer is the build's and
// specs/audio.md forbids it playing anything "before the first interaction", so a
// build free to create its bus and its mute bit on the first real gesture must be
// given one before it is graded on that bit.
//
// WHAT MUTE DOES TO THE SOUND IS A DIFFERENT POINT. `audio.mute-silences` reads
// that no cue is emitted while the bit is set, and `hud.mute-read` reads that the
// panel's control shows it. This point reads that the key reaches the action.
//
// THE WORLD IS AN EMPTY, QUIET, LIVE RUN, so no cue and no event of the run's own
// can touch the bit while the two presses are read. The action works "from any
// screen", and `screens.*` covers the screens; live play is where a player reaches
// for it.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";

/** The key specs/controls.md binds `mute` to, and the only one. */
const KEY = BINDINGS.mute;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("flips the muted bit on a KeyM press and flips it back on the next", async () => {
  await startRun(h);
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
    `${KEY}: the muted bit after one press, from a game that opened at ${String(opened)}`,
  );
  assertEqual(
    twice,
    opened,
    `${KEY}: the muted bit after a second press, back where it started`,
  );
});
