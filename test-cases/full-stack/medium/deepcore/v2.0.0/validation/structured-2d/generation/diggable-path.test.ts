// Deepcore — generation.diggable-path. STUB: NOT YET AUTHORED.
//
// A diggable route runs from the cave mouth to both nodes and the Core
//
// From the cave mouth there is a path to each material node and to the Core
// crossing only minable cells that are neither lava nor unbreakable stone, so
// every mine can be dug out without drilling lava or blasting a boulder.
//
// Automated validation: generate mines at several seeds and sizes and
// flood-fill from the cave mouth across cells that are minable and neither
// lava nor stone, holding both node cells and the Core reachable.
//
// `test-case.toml` declares this suite as `generation/diggable-path.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (route (image)) around the drive.

import { test } from "vitest";

test("A diggable route runs from the cave mouth to both nodes and the Core", () => {
  throw new Error(
    "Deepcore validator `generation/diggable-path` is declared in test-case.toml but has not been authored yet.",
  );
});
