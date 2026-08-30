// Deepcore — notices.notice-delay. STUB: NOT YET AUTHORED.
//
// The card appears a moment after the hit
//
// The card appears NOTICE_DELAY (1.5) seconds after the hit, so the
// detonation, the shake and the hull drop land first and notice.shown stays
// false over the delay.
//
// Automated validation: detonate a posed pocket and sample notice.shown either
// side of NOTICE_DELAY.
//
// `test-case.toml` declares this suite as `notices/notice-delay.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (beat (replay)) around the drive.

import { test } from "vitest";

test("The card appears a moment after the hit", () => {
  throw new Error(
    "Deepcore validator `notices/notice-delay` is declared in test-case.toml but has not been authored yet.",
  );
});
