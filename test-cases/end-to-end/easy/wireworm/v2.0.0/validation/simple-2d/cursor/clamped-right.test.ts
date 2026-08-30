// Wireworm — cursor.clamped-right, under the `simple-2d` engine. CASE-PROVIDED.
//
// PLACEHOLDER. The scaffold stage created this file so the manifest resolves; the
// validation stage replaces it with the suite that decides the point. It fails
// deliberately, so an unwritten validator can never read as a passing one.
//
// The point it decides, from `test-case.toml`:
//
// The cursor stops at the right edge
//
// Posed 120 units inside the right bound and driven right for a second, the
// cursor's centre x rests at CURSOR_X_MAX (1264) and goes no higher.

import { test } from "vitest";

test("cursor.clamped-right", () => {
  throw new Error(
    "wireworm v2.0.0: validation/simple-2d/cursor/clamped-right.test.ts has not been written yet",
  );
});
