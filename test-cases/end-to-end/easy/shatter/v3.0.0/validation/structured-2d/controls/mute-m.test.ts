// controls/mute-m — `KeyM` toggles mute, and `muted` reports it.
//
// `specs/controls.md` binds `KeyM` to the `mute` action and gives it one meaning
// on every screen — Toggle sound — and reads it as a press edge, "once per
// press". `specs/audio.md` says whose bit it is: "Muting belongs to the engine.
// The game binds the mute action to the engine's mute bit and toggles it from
// any screen." `specs/instrumentation.md` says how it is read back: there is no
// operation that sets it — "mute is reached the way a player reaches it, through
// its action in `specs/controls.md`, and the snapshot reports the result" — and
// the snapshot's `muted` is "The runtime's own mute bit, refreshed in every
// update."
//
// A TOGGLE IS TWO PRESSES, NOT ONE. A single press proves only that something
// moved; a build that LATCHES mute on rather than toggling it passes that and
// leaves a player unable to turn the sound back on. So the bit is read after one
// press and again after a second, and the requirement is that it flipped and
// flipped back.
//
// THE BIT IT STARTS ON IS READ, NOT ASSUMED. `specs/audio.md` fixes muting as a
// toggle and `reset` is explicit that "`muted` is left exactly as it stands;
// muting is the runtime's" — no spec fixes which state a fresh game opens in. So
// this check reads the bit as it stands and requires each press to invert it,
// which is exactly what a toggle is and is all the specification states. A build
// that opens muted is not failed for it here.
//
// AND THE FLIP IS THE KEY'S DOING. A quarter second is driven first with nothing
// down and the bit read either side of it, so a build whose mute bit oscillates
// on its own is caught rather than passing on a coincidence.
//
// THE TITLE SCREEN, because the key works on every screen and the title is the
// one the game opens on: nothing has to be posed for the reading to be honest.
//
// WHAT THIS DOES NOT DECIDE. That a muted bus is actually SILENT: under this
// engine `specs/audio.md` puts the silencing with the runtime, so no item on this
// engine reads it. Nor that the game keeps playing with the bit set, which is
// `audio/mute-silences`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  ticksFor,
  type Harness,
} from "../harness";

/** The key this point is about, as `specs/controls.md`'s table names it. */
const KEY = "KeyM";

/** The quiet stretch driven before the key goes down, in ticks. */
const QUIET_TICKS = ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("inverts the reported mute bit on each press of KeyM", async () => {
  // The title screen a fresh `reset` leaves. `muted` is refreshed in an update,
  // so one frame runs before the bit is first read.
  resetTo(h);
  await h.advance(1);
  const opened = h.snapshot().muted;

  await h.advance(QUIET_TICKS);
  const quiet = h.snapshot().muted;

  await h.tap(KEY);
  const pressed = h.snapshot().muted;
  captureStill(h, "muted");

  await h.tap(KEY);
  const pressedAgain = h.snapshot().muted;

  assertEqual(
    quiet,
    opened,
    `the reported mute bit after ${String(QUIET_TICKS)} ticks with no key ` +
      "down — mute moves only on a press of its key (specs/controls.md)",
  );
  assertEqual(
    pressed,
    !opened,
    `the reported mute bit after one press of ${KEY} — the key toggles the ` +
      "runtime's mute bit from any screen (specs/audio.md) and the snapshot " +
      `reports it (specs/instrumentation.md); it stood at ${String(opened)}`,
  );
  assertEqual(
    pressedAgain,
    opened,
    `the reported mute bit after a second press of ${KEY} — mute is a TOGGLE ` +
      "read once per press (specs/controls.md), so the second press puts it " +
      "back rather than latching it on",
  );
});
