// Wireworm — discharge.arcs-reported, under the `none` engine. CASE-PROVIDED.
//
// PLACEHOLDER. The scaffold stage created this file so the manifest resolves; the
// validation stage replaces it with the suite that decides the point. It fails
// deliberately, so an unwritten validator can never read as a passing one.
//
// The point it decides, from `test-case.toml`:
//
// The discharge reports one arc per conducted link
//
// The snapshot reports one arc per link the chain conducted along, each naming
// the two tiles it joined, and reports none once ARC_LIFE (0.32 s) has passed.

import { test } from "vitest";

test("discharge.arcs-reported", () => {
  throw new Error(
    "wireworm v2.0.0: validation/none/discharge/arcs-reported.test.ts has not been written yet",
  );
});
