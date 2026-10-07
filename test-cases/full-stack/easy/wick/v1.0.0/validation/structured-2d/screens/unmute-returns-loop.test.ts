// Wick — screens/unmute-returns-loop: unmuting gives the music back where it
// was, without starting it again.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, Audio: "A muted loop
// keeps looping silently and returns when unmuted." `specs/ui.md`,
// "The loops": "`music` is looping on every frame exactly when `screen` is
// `playing`, `levelup`, `chest`, or `paused`. It starts on the frame a fresh
// run starts and keeps playing through the overlays and the pause, and it
// stops on the frame the run ends", so nothing about a mute either stops it or
// starts it.
//
// WHAT "NEVER RESTARTED" IS READ AS. The engine announces every start of a
// loop on its cue bus, and the harness records each announcement. A collector
// is opened AFTER the mute and read after the unmute, so what it holds is
// exactly the loop starts the unmuting frame caused: a build that stopped
// `music` on muting and started it again on unmuting announces one there, and
// a build that left the loop alone announces none.
//
// THE DRIVE. An isolated `playing` world with every driver switch off, one
// frame to let the reconciliation start `music`, one real `KeyM` to mute, then
// the `KeyM` this point is about.
//
// THE TOLERANCE. None: two booleans off the engine's audio bus and a count of
// announcements.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { CUES } from "../constants";
import {
  captureStill,
  createHarness,
  cuesNamed,
  isolate,
  onCue,
  tap,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads unmuted with the same music loop still running", async () => {
  isolate(h);
  await h.advance(1);
  assertEqual(h.looping(CUES.music), true, "music looping before muting");

  const muted = await tap(h, "KeyM");
  assertEqual(muted.muted, true, "muted before the press");
  assertEqual(h.looping(CUES.music), true, "music looping while muted");

  const played = onCue(h);
  const after = await tap(h, "KeyM");
  captureStill(h, "returned");

  assertEqual(after.muted, false, "muted after the second KeyM");
  assertEqual(h.looping(CUES.music), true, "music looping after unmuting");
  assertLength(
    cuesNamed(played, CUES.music),
    0,
    "music loops started by the unmuting frame (specs/ui.md, Audio)",
  );
});
