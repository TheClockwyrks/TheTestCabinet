// Wireworm — cursor.bolt-travels-up, under the `simple-2d` engine. CASE-PROVIDED.
//
// PLACEHOLDER. The scaffold stage created this file so the manifest resolves; the
// validation stage replaces it with the suite that decides the point. It fails
// deliberately, so an unwritten validator can never read as a passing one.
//
// The point it decides, from `test-case.toml`:
//
// A bolt climbs at 900 units/s
//
// A bolt posed with addBolt(x, 704) on a clear column rises 450 units —
// BOLT_SPEED (900) over a 0.5 s window — within 5%, ending near y = 254, well
// inside the board. The window is sized to the board: it is only 640 units
// tall, so a full second at 900 units/s would take the bolt off the top, where
// cursor.bolt-vanishes-at-top requires it to be gone.

import { test } from "vitest";

test("cursor.bolt-travels-up", () => {
  throw new Error(
    "wireworm v2.0.0: validation/simple-2d/cursor/bolt-travels-up.test.ts has not been written yet",
  );
});
