// Deepcore — rendering.tunnel-joins-and-separates. STUB: NOT YET AUTHORED.
//
// Adjacent tunnels join and diagonal ones do not
//
// Orthogonally adjacent open cells join into one passage with no dirt lip
// between them, while cells touching only at a corner stay separate with the
// dirt still between them.
//
// Automated validation: pose one orthogonal pair and one diagonal pair of open
// cells and sample the boundary between each, holding the first joined and the
// second separated.
//
// `test-case.toml` declares this suite as `rendering/tunnel-joins-and-separates.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (join (image)) around the drive.

import { test } from "vitest";

test("Adjacent tunnels join and diagonal ones do not", () => {
  throw new Error(
    "Deepcore validator `rendering/tunnel-joins-and-separates` is declared in test-case.toml but has not been authored yet.",
  );
});
