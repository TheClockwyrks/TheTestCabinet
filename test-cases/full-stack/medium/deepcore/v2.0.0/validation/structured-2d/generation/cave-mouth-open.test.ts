// Deepcore — generation.cave-mouth-open. STUB: NOT YET AUTHORED.
//
// The cave mouth is open in every mine
//
// The cell (CAVE_MOUTH_COL, 1), that is (26, 1), is an open tunnel in every
// generated mine, so the way down out of the camp is never sealed behind the
// first row of rock.
//
// Automated validation: generate mines at several seeds and sizes and read
// tileAt at the cave mouth, holding the kind at tunnel.
//
// `test-case.toml` declares this suite as `generation/cave-mouth-open.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (mouth (image)) around the drive.

import { test } from "vitest";

test("The cave mouth is open in every mine", () => {
  throw new Error(
    "Deepcore validator `generation/cave-mouth-open` is declared in test-case.toml but has not been authored yet.",
  );
});
