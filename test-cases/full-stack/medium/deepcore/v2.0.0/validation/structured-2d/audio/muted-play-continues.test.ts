// Deepcore — audio.muted-play-continues. STUB: NOT YET AUTHORED.
//
// Muting changes nothing but the sound
//
// Muting silences the audio and changes nothing else: the simulation carries
// on and cues still fire at the same moments, so unmuting mid-play picks up
// where the game is.
//
// Automated validation: drive one identical posed scenario muted and unmuted
// and hold the resulting state and the cue events equal.
//
// `test-case.toml` declares this suite as `audio/muted-play-continues.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (same (replay)) around the drive.

import { test } from "vitest";

test("Muting changes nothing but the sound", () => {
  throw new Error(
    "Deepcore validator `audio/muted-play-continues` is declared in test-case.toml but has not been authored yet.",
  );
});
