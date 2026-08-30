// Deepcore — audio.mute-toggle. STUB: NOT YET AUTHORED.
//
// The mute control silences everything
//
// The mute action and the status-bar mute control both toggle all audio, so no
// cue is audible while muted.
//
// Automated validation: mute, then fire several cue-bearing events and observe
// each play reported silent, then unmute and observe them audible again.
//
// `test-case.toml` declares this suite as `audio/mute-toggle.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (muted (replay)) around the drive.

import { test } from "vitest";

test("The mute control silences everything", () => {
  throw new Error(
    "Deepcore validator `audio/mute-toggle` is declared in test-case.toml but has not been authored yet.",
  );
});
