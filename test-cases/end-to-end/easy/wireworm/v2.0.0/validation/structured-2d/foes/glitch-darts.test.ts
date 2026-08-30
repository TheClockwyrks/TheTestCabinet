// Wireworm — foes.glitch-darts, under the `structured-2d` engine. CASE-PROVIDED.
//
// PLACEHOLDER. The scaffold stage created this file so the manifest resolves; the
// validation stage replaces it with the suite that decides the point. It fails
// deliberately, so an unwritten validator can never read as a passing one.
//
// The point it decides, from `test-case.toml`:
//
// The glitch reverses at each dart interval
//
// specs/foes.md states the rule outright — at each GLITCH_DART_INTERVAL (0.32
// s) the glitch reverses its horizontal direction — and the item asserts that
// stated rule: over three seconds the reported vx reverses sign at each
// interval boundary, nine reversals in all, and the distance swept each way is
// reported so a failure names a number. The rule is stated rather than left to
// a random re-pick precisely so a spec-honouring build cannot fail on an
// unlucky seed.

import { test } from "vitest";

test("foes.glitch-darts", () => {
  throw new Error(
    "wireworm v2.0.0: validation/structured-2d/foes/glitch-darts.test.ts has not been written yet",
  );
});
