// Deepcore — movement.open-sky. STUB: NOT YET AUTHORED.
//
// The sky above the camp is unbounded
//
// Thrusting up off the surface carries the miner into the open sky with no
// invisible lid, so it keeps climbing while it has fuel, rising well above the
// camp before falling back when thrust is released.
//
// Automated validation: pose the miner on the camp ground with a full tank,
// hold thrust for a sustained span, and hold the height reached above the
// surface with no ceiling met.
//
// `test-case.toml` declares this suite as `movement/open-sky.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (sky (replay)) around the drive.

import { test } from "vitest";

test("The sky above the camp is unbounded", () => {
  throw new Error(
    "Deepcore validator `movement/open-sky` is declared in test-case.toml but has not been authored yet.",
  );
});
