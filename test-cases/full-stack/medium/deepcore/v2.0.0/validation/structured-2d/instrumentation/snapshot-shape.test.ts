// Deepcore — instrumentation.snapshot-shape. STUB: NOT YET AUTHORED.
//
// Snapshot reports the full documented shape
//
// On a posed expedition carrying cargo, a material, a live Core Sample, a
// scanner lock and a drill in progress, the snapshot reports version
// DEEPCORE_DEBUG_VERSION (1) and every field specs/instrumentation.md lists
// with its documented type, including the nested camera, miner, cargo,
// satchel, tiers, items, rocket, scanner and noticesFired objects.
//
// Automated validation: pose an expedition exercising every branch of the
// shape and hold each reported field against the documented shape, field by
// field.
//
// `test-case.toml` declares this suite as `instrumentation/snapshot-shape.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (posed (image)) around the drive.

import { test } from "vitest";

test("Snapshot reports the full documented shape", () => {
  throw new Error(
    "Deepcore validator `instrumentation/snapshot-shape` is declared in test-case.toml but has not been authored yet.",
  );
});
