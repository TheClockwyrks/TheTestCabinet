// Deepcore — screens.advances-in-real-time. STUB: NOT YET AUTHORED.
//
// The game advances on its own
//
// With the clock running rather than driven, the game advances by itself: a
// miner left falling keeps falling and simTime keeps climbing without any
// call.
//
// Automated validation: let the wall clock run over a posed fall and read
// simTime and the miner position moving with no advance called.
//
// `test-case.toml` declares this suite as `screens/advances-in-real-time.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (running (replay)) around the drive.

import { test } from "vitest";

test("The game advances on its own", () => {
  throw new Error(
    "Deepcore validator `screens/advances-in-real-time` is declared in test-case.toml but has not been authored yet.",
  );
});
