// Wireworm — worm.dive-passes-through-node, under the `simple-2d` engine. CASE-PROVIDED.
//
// PLACEHOLDER. The scaffold stage created this file so the manifest resolves; the
// validation stage replaces it with the suite that decides the point. It fails
// deliberately, so an unwritten validator can never read as a passing one.
//
// The point it decides, from `test-case.toml`:
//
// A diving worm passes through the nodes below it
//
// A diving worm crossing a column of charge-2 nodes ends each step one row
// lower, on the tile the node stands on. What happens to those nodes is
// nodes.dive-leaves-charge's requirement.

import { test } from "vitest";

test("worm.dive-passes-through-node", () => {
  throw new Error(
    "wireworm v2.0.0: validation/simple-2d/worm/dive-passes-through-node.test.ts has not been written yet",
  );
});
