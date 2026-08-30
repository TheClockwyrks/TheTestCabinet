// Wireworm — cursor.fire-interval, under the `structured-2d` engine. CASE-PROVIDED.
//
// PLACEHOLDER. The scaffold stage created this file so the manifest resolves; the
// validation stage replaces it with the suite that decides the point. It fails
// deliberately, so an unwritten validator can never read as a passing one.
//
// The point it decides, from `test-case.toml`:
//
// Held fire produces a bolt every 0.15 s
//
// Holding the fire key for 0.35 s from a zero cooldown over an empty column
// produces three bolts, the two intervals between them FIRE_INTERVAL (0.15 s)
// within 10%. The window stops short of MAX_BOLTS (3) binding, so the cap
// never enters the reading; a longer hold would measure cursor.bolt-cap's
// requirement instead, and no column on a 640-unit board is tall enough for a
// 900 units/s bolt to outrun a one-second hold.

import { test } from "vitest";

test("cursor.fire-interval", () => {
  throw new Error(
    "wireworm v2.0.0: validation/structured-2d/cursor/fire-interval.test.ts has not been written yet",
  );
});
