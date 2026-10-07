// Spectra — controls/mute-m: `KeyM` toggles the reported mute bit.
//
// THE RULE. `specs/controls.md` binds the `mute` action — "Toggles sound, from any
// screen." — to `KeyM` alone, reads it as a press edge, and lists `mute` in EVERY
// screen's row of its table. `specs/instrumentation.md` says there is no operation
// that sets muting — "`mute` is reached the way a player reaches it, through its
// binding in `specs/controls.md`, and the snapshot reports the result" — and that
// `muted` is the game's copy of the runtime's mute bit, refreshed in every update.
// This point decides that binding, in both directions: the first press sets the
// bit, and the second clears it.
//
// WHY IT IS CAPPED HARDER THAN ITS NEIGHBOURS. `KeyM` is mute's ONLY key: there is
// no alternate to fall back on.
//
// WHY BOTH DIRECTIONS. Because "toggles" is what the specification says, and one
// press cannot tell a toggle from a latch: a build whose `KeyM` writes `true`
// rather than the opposite passes a single press and has given the player no way
// to turn the sound back on. Each wrong model reads differently over the pair — a
// key wired to nothing leaves `false, false`, a latch leaves `true, true`, and a
// toggle reads `true, false`.
//
// BOTH HALVES OF THIS ARE THE BUILD'S OWN. Under this engine the audio layer, the
// mute bit and the keyboard are all in the runtime layer an engineless build
// writes (`specs/ui.md`, `specs/instrumentation.md`), and the game binds the action
// to that bit and mirrors it into its own state so the snapshot can report it. The
// whole path is exercised here.
//
// WHAT IS NOT ASSERTED, AND WHY THAT IS DELIBERATE. That muting actually silences
// the game. `specs/ui.md` states that at source strength — while muted the game
// starts no sound at all — and `audio/mute-silences` is the point that reads it,
// through the only honest signal there is under this engine: whether a source was
// started at all. Restating it here would cost one build two points for one fault.
// The mute INDICATOR the bottom strip draws is `screens/mute-indicator`'s.
//
// THE SCREEN IS THE TITLE, WHERE MUTE STARTS OFF. `mute` is read on every screen,
// so the choice is free; the title is where a fresh page opens, and
// `createHarness` has just `reset` it. `specs/instrumentation.md` says `reset`
// leaves `muted` exactly as it stands, which is why the opening read below is an
// assertion rather than an assumption: a page that had somehow opened muted would
// make the rest of this suite meaningless.
//
// THE KEY IS A REAL ONE. `tap` presses the key down, runs exactly one frame with
// it held, and releases it, all through Chromium's own input pipeline — and that
// frame is also the update in which the game refreshes its copy of the runtime's
// bit, so what is read back afterwards is a real mirror rather than a stale one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

/** The one key `specs/controls.md` binds `mute` to. */
const MUTE_KEY = "KeyM";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sets the mute bit on the first M, and clears it on the second", async () => {
  await h.advance(1); // one update, so the mirrored bit is a fresh read
  const opened = await h.snapshot();
  assertEqual(opened.screen, "title", "the game opens on the title screen");
  assertEqual(opened.muted, false, "and it opens unmuted");

  await h.tap(MUTE_KEY);
  await captureStill(h, "muted");
  assertEqual((await h.snapshot()).muted, true, "M muted the game");

  await h.tap(MUTE_KEY);
  assertEqual(
    (await h.snapshot()).muted,
    false,
    "and a second M unmuted it, so it toggles rather than latches",
  );
});
