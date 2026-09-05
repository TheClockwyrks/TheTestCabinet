// controls/mute-m — `KeyM` toggles mute, and `muted` follows it both ways.
//
// THE RULE. `specs/controls.md` binds `KeyM` to the `mute` action and gives it
// "Toggle sound" in BOTH columns of its action table — while the game is being
// played and on a menu alike — and reads muting as a press edge, "once per press".
// `specs/audio.md` says whose bit it is under this engine: "Muting belongs to the
// engine. The game binds the mute action to the engine's mute bit and toggles it
// from any screen." `specs/instrumentation.md` says the snapshot must follow it —
// "`muted` is the game's copy of the runtime's mute bit, refreshed in every update.
// No operation sets it; the mute key does." So what this item grades is the join:
// the build reading the action, driving the ENGINE's bit with it, and mirroring
// that bit into the state a check can read.
//
// A TOGGLE, NOT A LATCH — WHICH IS WHY IT IS PRESSED TWICE. One press flips the
// bit; a second press flips it back. A build that set the bit and never cleared it
// passes the first reading and fails the second, and that is the fault this item is
// shaped to catch. The starting value is READ rather than assumed: no specification
// here fixes what mute reads on a fresh page, so what is asserted is that each
// press inverts whatever stood before it.
//
// THE KEY IS A REAL ONE. `tap` presses the key, runs the frame that delivers it,
// releases it, and runs one more, all as `KeyboardEvent`-shaped events at the event
// target the engine listens on, which the engine's input contract states drives an
// action exactly as a player's key does — and delivered by its `code`, which is
// what makes `KeyM` the PHYSICAL key rather than the character a layout happens to
// put there. `specs/instrumentation.md` deliberately gives the surface no operation
// that sets muting — "mute is reached the way a player reaches it, through its
// action in `specs/controls.md`" — so this key is the only route to the bit. The second of `tap`'s two frames also
// gives the "refreshed in every update" copy a further update to be read in, so a
// build that mirrors the bit at the top of the frame is graded the same as one that
// mirrors it at the bottom.
//
// WHAT THIS ITEM DOES NOT DECIDE, AND DELIBERATELY SO. That the speakers went
// QUIET: under this engine `specs/audio.md` puts the silencing with the runtime,
// so no item on this engine reads it, and `audio/mute-silences` decides instead
// that the game stays fully playable with the bit set. Nor that muting
// SURVIVES a reset, which `specs/instrumentation.md` fixes ("`muted` is left
// exactly as it stands") and `instrumentation/reset-restores-title` grades.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS } from "../constants";
import { assertContains, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";

/** The key this item decides, and the action `specs/controls.md` binds it to. */
const KEY = "KeyM";
const ACTION = "mute";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("flips muted on a press of KeyM, and flips it back on the next", async () => {
  assertContains(
    BINDINGS[ACTION].keys,
    KEY,
    "the keys specs/controls.md binds the `mute` action to",
  );

  startPlaying(h);
  const before = h.snapshot().muted;

  await h.tap(KEY);
  captureStill(h, "muted");
  assertEqual(
    h.snapshot().muted,
    !before,
    "muted after one press of KeyM, which specs/audio.md makes a toggle",
  );

  await h.tap(KEY);
  assertEqual(
    h.snapshot().muted,
    before,
    "muted after a second press of KeyM, which must undo the first",
  );
});
