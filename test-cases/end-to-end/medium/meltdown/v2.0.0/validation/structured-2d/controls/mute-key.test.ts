// Meltdown — controls/mute-key: KeyM toggles mute, and toggles it back.
//
// THE RULE. specs/controls.md binds `mute` to `KeyM` (The bindings) and gives it
// the effect "Toggles sound, from any screen" (The actions).
// specs/instrumentation.md makes the bit readable and, in the same breath, says
// why this item has to reach through the real key: "`muted` is the game's copy of
// the runtime's mute bit, refreshed in every update... No operation sets it; the
// `mute` action and the panel's mute control do." There is no `setMuted` to pose
// with.
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
// THE MIRROR IS GIVEN ITS FRAMES. The snapshot's `muted` is a copy "refreshed in
// every update ... not read at the call", so a build is free to refresh it before
// or after the frame that answered the press. `settleMuteMirror` runs the frames
// that make the reading the same either way; it is a settling allowance and not a
// tolerance on any figure.
//
// WHAT MUTE DOES TO THE SOUND IS A DIFFERENT ITEM. `audio.mute-silences` reads
// that no cue is heard while the bit is set, and `hud.mute-read` that the panel's
// control shows it. This item reads that the key reaches the action.
//
// THE WORLD IS AN EMPTY, QUIET, LIVE RUN, so no cue and no event of the run's own
// can touch the bit while the two presses are read. The action works "from any
// screen", and the screens are `screens.*`; live play is where a player reaches
// for it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { settleMuteMirror } from "./scene";

/** The key specs/controls.md binds `mute` to, as a `KeyboardEvent.code`. */
const KEY = "KeyM";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("flips the muted bit on a KeyM press and flips it back on the next", async () => {
  startRun(h);
  await h.advance(1);
  const opened = h.snapshot().muted;

  await h.tap(KEY);
  await settleMuteMirror(h);
  const once = h.snapshot().muted;
  captureStill(h, "muted");

  await h.tap(KEY);
  await settleMuteMirror(h);
  const twice = h.snapshot().muted;

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
