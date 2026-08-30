// Wireworm — cursor.clamped-bottom, under the `none` engine. CASE-PROVIDED.
//
// PLACEHOLDER. The scaffold stage created this file so the manifest resolves; the
// validation stage replaces it with the suite that decides the point. It fails
// deliberately, so an unwritten validator can never read as a passing one.
//
// The point it decides, from `test-case.toml`:
//
// The cursor stops at the floor
//
// Posed at CURSOR_Y_MIN (672) and driven down for a second, the cursor's
// centre y rests at CURSOR_Y_MAX (704) and goes no higher.

import { test } from "vitest";

test("cursor.clamped-bottom", () => {
  throw new Error(
    "wireworm v2.0.0: validation/none/cursor/clamped-bottom.test.ts has not been written yet",
  );
});
