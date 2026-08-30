// Deepcore — assets.audio-files-present. STUB: NOT YET AUTHORED.
//
// Every named cue has a produced sound file
//
// All thirteen files specs/assets.md names under assets/audio/ exist, decode
// as audio and are not silent, so no cue is wired to a missing or empty file.
//
// Automated validation: read each of the thirteen audio files, decode it and
// hold it non-empty with a non-zero peak.
//
// `test-case.toml` declares this suite as `assets/audio-files-present.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (audio (image)) around the drive.

import { test } from "vitest";

test("Every named cue has a produced sound file", () => {
  throw new Error(
    "Deepcore validator `assets/audio-files-present` is declared in test-case.toml but has not been authored yet.",
  );
});
