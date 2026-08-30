// Deepcore — rendering.tunnel-corner-nub. STUB: NOT YET AUTHORED.
//
// An L-bend keeps a convex nub of dirt
//
// At an L-bend or a T-junction, where solid rock pokes diagonally into the
// bend, the dirt keeps a convex nub bulging into the tunnel rather than a
// scooped-out concave notch.
//
// Automated validation: pose an L-bend of open cells and sample the drawn
// corner against the diagonal rock, holding the dirt bulging into the tunnel
// rather than away from it.
//
// `test-case.toml` declares this suite as `rendering/tunnel-corner-nub.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (bend (image)) around the drive.

import { test } from "vitest";

test("An L-bend keeps a convex nub of dirt", () => {
  throw new Error(
    "Deepcore validator `rendering/tunnel-corner-nub` is declared in test-case.toml but has not been authored yet.",
  );
});
