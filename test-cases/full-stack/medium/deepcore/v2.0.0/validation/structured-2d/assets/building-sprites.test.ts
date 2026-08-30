// Deepcore — assets.building-sprites. STUB: NOT YET AUTHORED.
//
// Every camp fixture has a produced sprite
//
// A sprite exists at assets/surface/<id>.png for each of the six buildings by
// its id, plus cave-mouth, ground and sky, and no two of the six buildings are
// identical.
//
// Automated validation: read the nine surface files and hold each present and
// the six building sprites mutually different.
//
// `test-case.toml` declares this suite as `assets/building-sprites.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (camp (image)) around the drive.

import { test } from "vitest";

test("Every camp fixture has a produced sprite", () => {
  throw new Error(
    "Deepcore validator `assets/building-sprites` is declared in test-case.toml but has not been authored yet.",
  );
});
