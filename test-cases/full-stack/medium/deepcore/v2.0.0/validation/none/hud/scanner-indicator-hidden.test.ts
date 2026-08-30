// Deepcore — hud.scanner-indicator-hidden. STUB: NOT YET AUTHORED.
//
// Nothing is drawn when nothing is locked
//
// With no scanner, or with the target out of range, nothing is drawn: the
// indicator is absent rather than drawn empty or pointing nowhere.
//
// Automated validation: read the drawn frame at scanner tier 1 and with the
// node out of range and hold both identical to the same frame with no scanner
// at all.
//
// `test-case.toml` declares this suite as `hud/scanner-indicator-hidden.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (hidden (image)) around the drive.

import { test } from "vitest";

test("Nothing is drawn when nothing is locked", () => {
  throw new Error(
    "Deepcore validator `hud/scanner-indicator-hidden` is declared in test-case.toml but has not been authored yet.",
  );
});
