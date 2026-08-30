// Wireworm — discharge.detonated-once, under the `structured-2d` engine. CASE-PROVIDED.
//
// PLACEHOLDER. The scaffold stage created this file so the manifest resolves; the
// validation stage replaces it with the suite that decides the point. It fails
// deliberately, so an unwritten validator can never read as a passing one.
//
// The point it decides, from `test-case.toml`:
//
// A node is detonated at most once per discharge
//
// On a dense charged cluster whose nodes each lie in several blast radii, no
// ordered { from, to } pair appears twice in the reported arcs: a node
// detonated a second time re-emits its links, so a duplicated link is the
// witness. The item reads the discharge's own surface rather than the score,
// which is scoring.purge-node's requirement.

import { test } from "vitest";

test("discharge.detonated-once", () => {
  throw new Error(
    "wireworm v2.0.0: validation/structured-2d/discharge/detonated-once.test.ts has not been written yet",
  );
});
