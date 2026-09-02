// Meltdown — controls/mute-key: KeyM toggles mute, and toggles it back.
//
// THE RULE. specs/controls.md binds `mute` to `KeyM` and gives it the effect
// "Toggles sound, from any screen." specs/instrumentation.md makes the bit
// readable and, in the same breath, says why this point has to reach through the
// real key: "`muted` is the game's copy of the runtime's mute bit, refreshed in
// every update... No operation sets it; the `mute` action and the panel's mute
// control do." There is no `setMuted` to pose with.
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
// A FRAME RUNS BETWEEN EACH PRESS AND ITS READING. The snapshot's `muted` is the
// game's COPY of the runtime's bit, "refreshed in every update" and explicitly
// "not read at the call" (specs/instrumentation.md), so a build is free to
// refresh its copy before it handles input or after it — and only a frame that has
// run past both orderings can be read. `MIRROR_TICKS` is that frame plus one, the
// smallest window that cannot depend on which order a build chose.
//
// WHAT MUTE DOES TO THE SOUND IS A DIFFERENT POINT. `audio.mute-silences` reads
// that no cue sounds while the bit is set, and `hud.mute-read` reads that the
// panel's control shows it. This point reads that the key reaches the action.
//
// THE WORLD IS AN EMPTY, QUIET, LIVE RUN, so no cue and no event of the run's own
// can touch the bit while the two presses are read. The action works "from any
// screen", and live play is where a player reaches for it.

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
const KEY = BINDINGS.mute[0];

/**
 * Frames run after each press before the bit is read back.
 *
 * `h.tap` runs the one frame that delivers the press edge; this is the frame
 * after it, so the game's mirrored copy has been refreshed by an update that
 * began after the press whichever order the build refreshes in
 * (specs/instrumentation.md).
 */
const MIRROR_TICKS = 1;

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
  await h.advance(MIRROR_TICKS);
  captureStill(h, "muted");
  const once = h.snapshot().muted;

  await h.tap(KEY);
  await h.advance(MIRROR_TICKS);
  const twice = h.snapshot().muted;

  assertEqual(
    once,
    !opened,
    `${KEY}: the muted bit after one press, from a game that opened at ` +
      `${String(opened)} (specs/controls.md, The actions)`,
  );
  assertEqual(
    twice,
    opened,
    `${KEY}: the muted bit after a second press, back where it started — the ` +
      "action is a toggle (specs/controls.md, The actions)",
  );
});
