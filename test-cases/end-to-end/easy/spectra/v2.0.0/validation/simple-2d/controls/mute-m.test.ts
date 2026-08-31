// Spectra — controls/mute-m: `KeyM` toggles the reported mute bit.
//
// THE RULE. `specs/controls.md` binds the `mute` action — "Toggles sound, from any
// screen." — to `KeyM` alone, reads it as a press EDGE, and lists `mute` in EVERY
// screen's row of its table. `specs/instrumentation.md` says there is no operation
// that sets muting — "`mute` is reached the way a player reaches it, through its
// binding in `specs/controls.md`, and the snapshot reports the result" — and that
// `muted` is the game's copy of the runtime's mute bit, refreshed in every update.
// This point decides that binding, in both directions: the first press sets the bit,
// and the second clears it.
//
// WHY IT IS CAPPED HARDER THAN ITS NEIGHBOURS. `KeyM` is mute's ONLY key: there is no
// alternate to fall back on.
//
// WHY BOTH DIRECTIONS. Because "toggles" is what the specification says, and one
// press cannot tell a toggle from a latch: a build whose `KeyM` writes `true` rather
// than the opposite passes a single press and has given the player no way to turn the
// sound back on. Each wrong model reads differently over the pair — a key wired to
// nothing leaves `false, false`, a latch leaves `true, true`, and only a toggle reads
// `true, false`.
//
// WHAT THE BUILD OWES HERE, UNDER THIS ENGINE. The bus and its mute bit are the
// engine's (`specs/instrumentation.md`), so what this point exercises is the build's
// own half: registering `mute` against `KeyM`, reading its edge, asking the engine to
// invert its bit, and mirroring the result into the state the snapshot reports. A
// build that does any of the four wrong reads back the wrong pair.
//
// WHAT IS NOT ASSERTED, AND WHY THAT IS DELIBERATE. That muting actually silences the
// game. `specs/ui.md` states that at source strength — while muted the game starts no
// sound at all — and `audio/mute-silences` is the point that reads it. Restating it
// here would cost one build two points for one fault. The mute INDICATOR the bottom
// strip draws is `screens/mute-indicator`'s.
//
// THE SCREEN IS THE TITLE, WHERE MUTE STARTS OFF. `mute` is read on every screen, so
// the choice is free; the title is where a fresh page opens. `specs/instrumentation.md`
// says `reset` leaves `muted` exactly as it stands, which is why the opening read
// below is an assertion rather than an assumption: a build that had somehow opened
// muted would make the rest of this suite meaningless.
//
// THE KEY IS TAPPED, AND IT IS A REAL ONE. `specs/controls.md` reads `mute` as an
// edge, so a conforming build resolves it through the engine's `pressed`: `tap`
// presses the key, releases it, and runs the one frame that delivers the armed edge —
// and that frame is also the update in which the game refreshes its copy of the
// engine's bit, so what is read back afterwards is a real mirror rather than a stale
// one. The code below is the LITERAL `specs/controls.md` states rather than
// `BINDINGS.mute[0]`: that table is the build's own copy of the very thing this point
// decides.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

/** The one key `specs/controls.md` binds `mute` to, written out as it states it. */
const MUTE_KEY = "KeyM";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sets the mute bit on the first M, and clears it on the second", async () => {
  // One update, so the bit the game mirrors is a fresh read rather than whatever
  // its opening state happened to carry.
  await h.advance(1);
  const opened = h.snapshot();
  assertEqual(opened.screen, "title", "the game opens on the title screen");
  assertEqual(
    opened.muted,
    false,
    "the mute bit the game reports before any press",
  );

  await h.tap(MUTE_KEY);
  // Before the assertions, so a check that fails still leaves the picture of the
  // screen the first press left behind.
  captureStill(h, "muted");
  assertEqual(
    h.snapshot().muted,
    true,
    "the mute bit one frame after M was pressed, which specs/controls.md says " +
      "the action toggles",
  );

  await h.tap(MUTE_KEY);
  assertEqual(
    h.snapshot().muted,
    false,
    "the mute bit after a second M, which must come back to false: the action " +
      "toggles rather than latching (specs/controls.md)",
  );
});
