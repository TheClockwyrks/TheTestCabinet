// Wireworm — cursor.diagonal-speed, under the `none` engine. CASE-PROVIDED.
//
// PLACEHOLDER. The scaffold stage created this file so the manifest resolves; the
// validation stage replaces it with the suite that decides the point. It fails
// deliberately, so an unwritten validator can never read as a passing one.
//
// The point it decides, from `test-case.toml`:
//
// A diagonal hold is no faster
//
// Right and up held together for one second move the cursor CURSOR_SPEED /
// sqrt(2) (304) units horizontally, within 5%, rather than the 430 an
// unnormalized diagonal would give. The horizontal component is the readable
// one: the vertical component clamps out after 32 units, and a total-path
// figure is unreachable in a 32-unit-tall band.

import { test } from "vitest";

test("cursor.diagonal-speed", () => {
  throw new Error(
    "wireworm v2.0.0: validation/none/cursor/diagonal-speed.test.ts has not been written yet",
  );
});
