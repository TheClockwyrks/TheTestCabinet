// Wireworm — cursor.clamped-left, under the `structured-2d` engine. CASE-PROVIDED.
//
// PLACEHOLDER. The scaffold stage created this file so the manifest resolves; the
// validation stage replaces it with the suite that decides the point. It fails
// deliberately, so an unwritten validator can never read as a passing one.
//
// The point it decides, from `test-case.toml`:
//
// The cursor stops at the left edge
//
// Posed 120 units inside the left bound — the inset is the horizontal pair's,
// since only the horizontal axis is wide enough to hold it — and driven left
// for a second, the cursor's centre x rests at CURSOR_X_MIN (16) and goes no
// lower.

import { test } from "vitest";

test("cursor.clamped-left", () => {
  throw new Error(
    "wireworm v2.0.0: validation/structured-2d/cursor/clamped-left.test.ts has not been written yet",
  );
});
