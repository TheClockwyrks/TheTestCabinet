// Wireworm — cursor.move-speed, under the `simple-2d` engine. CASE-PROVIDED.
//
// PLACEHOLDER. The scaffold stage created this file so the manifest resolves; the
// validation stage replaces it with the suite that decides the point. It fails
// deliberately, so an unwritten validator can never read as a passing one.
//
// The point it decides, from `test-case.toml`:
//
// A held movement key moves at 430 units/s
//
// Held for exactly one second from mid-band, left and right, the cursor
// travels CURSOR_SPEED (430) units within 5%. Two horizontal probes only: the
// band is 32 units tall, so a vertical hold clamps after 0.074 s and would
// measure the clamp, not the rate. Vertical movement is controls.up-arrow and
// controls.down-arrow.

import { test } from "vitest";

test("cursor.move-speed", () => {
  throw new Error(
    "wireworm v2.0.0: validation/simple-2d/cursor/move-speed.test.ts has not been written yet",
  );
});
