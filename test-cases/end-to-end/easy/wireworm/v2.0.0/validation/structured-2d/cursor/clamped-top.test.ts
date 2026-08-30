// Wireworm — cursor.clamped-top, under the `structured-2d` engine. CASE-PROVIDED.
//
// PLACEHOLDER. The scaffold stage created this file so the manifest resolves; the
// validation stage replaces it with the suite that decides the point. It fails
// deliberately, so an unwritten validator can never read as a passing one.
//
// The point it decides, from `test-case.toml`:
//
// The cursor stops at the band's top
//
// Posed at CURSOR_Y_MAX (704), the opposite bound, and driven up for a second
// — thirteen times the 0.074 s the 32-unit band takes to cross — the cursor's
// centre y rests at CURSOR_Y_MIN (672) and goes no lower. The 120-unit inset
// the horizontal pair uses does not apply: the band cannot hold it, and
// setCursor applies the real clamp.

import { test } from "vitest";

test("cursor.clamped-top", () => {
  throw new Error(
    "wireworm v2.0.0: validation/structured-2d/cursor/clamped-top.test.ts has not been written yet",
  );
});
