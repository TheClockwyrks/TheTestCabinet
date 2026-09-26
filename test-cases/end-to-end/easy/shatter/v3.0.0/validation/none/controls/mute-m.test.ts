// Shatter — controls/mute-m: `KeyM` toggles mute, and `muted` follows it both ways.
//
// THE RULE. `specs/controls.md` binds `KeyM` to "Toggle sound" in both columns of its
// key table — while the game is being played and on a menu alike — and reads muting
// as a press edge, "once per press". `specs/audio.md` says whose bit it is under this
// engine: "Muting is yours as well, and the mute key toggles it from any screen", and
// `specs/instrumentation.md` says the snapshot must follow it — "`muted` is the
// game's copy of the runtime's mute bit, refreshed in every update". Both halves are
// therefore the build's here: the audio layer that owns the bit, and the game that
// binds the key to it and mirrors it into the state a check can read.
//
// A TOGGLE, NOT A LATCH — WHICH IS WHY IT IS PRESSED TWICE. One press flips the bit;
// a second press flips it back. A build that set the bit and never cleared it passes
// the first reading and fails the second, and that is the fault this item is shaped
// to catch. The starting value is READ rather than assumed: no specification here
// fixes what mute reads on a fresh page, so what is asserted is that each press
// inverts whatever stood before it.
//
// THE KEY IS A REAL ONE. `tap` presses the key, runs the one tick that delivers it,
// and releases it, all through Chromium's own input pipeline, and delivers it by its
// `code`, so `KeyM` is the PHYSICAL key rather than the character a layout happens to
// put there. `specs/instrumentation.md` deliberately gives the surface no operation
// that sets muting — "mute is reached the way a player reaches it, through its key"
// — so this key is the only route to the bit and the whole path from it to the
// snapshot is exercised.
//
// WHAT THIS ITEM DOES NOT DECIDE, AND DELIBERATELY SO. That the speakers went QUIET.
// `audio/mute-silences` is the item that reads the sounds, and even there the reading
// is a count rather than a waveform: the two conformant ways to mute — stopping the
// sources, or starting them at no gain — are indistinguishable from outside an
// engineless build, so requiring either would fail a build for choosing the other.
// Nor does it decide that muting SURVIVES a reset, which `specs/instrumentation.md`
// fixes ("`muted` is left exactly as it stands") and
// `instrumentation/reset-restores-title` grades.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { KEY_MUTE } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";

/** The key this item decides. */
const KEY = KEY_MUTE;

/**
 * One tick run after each press, before the reading is taken.
 *
 * `tap` already runs the tick that delivers the key, so a build that acts on the
 * press edge inside that tick has acted before this. This one tick is for the build
 * that LATCHES the edge and drains it at the top of the next tick, which
 * `specs/controls.md` leaves open, and for the "refreshed in every update" the
 * snapshot's copy of the bit is fixed by. It costs nothing either way — `tap` has
 * already released the key, so no further edge can arrive in it.
 */
const SETTLE_TICKS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("flips muted on a press of KeyM, and flips it back on the next", async () => {
  await startPlaying(h);
  const before = (await h.snapshot()).muted;

  await h.tap(KEY);
  await h.advance(SETTLE_TICKS);
  await captureStill(h, "muted");
  assertEqual(
    (await h.snapshot()).muted,
    !before,
    "muted after one press of KeyM, which specs/audio.md makes a toggle",
  );

  await h.tap(KEY);
  await h.advance(SETTLE_TICKS);
  assertEqual(
    (await h.snapshot()).muted,
    before,
    "muted after a second press of KeyM, which must undo the first",
  );
});
