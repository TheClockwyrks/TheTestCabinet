// Deepcore — panels.panel-opens-at-a-building. STUB: NOT YET AUTHORED.
//
// Activating a building opens its panel
//
// Standing at a surface building and activating it opens that building panel,
// for each of the five buildings that have one.
//
// Automated validation: walk the miner to each of the five panelled buildings
// in turn, activate and read panel at that building id.
//
// `test-case.toml` declares this suite as `panels/panel-opens-at-a-building.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (panel (image)) around the drive.

import { test } from "vitest";

test("Activating a building opens its panel", () => {
  throw new Error(
    "Deepcore validator `panels/panel-opens-at-a-building` is declared in test-case.toml but has not been authored yet.",
  );
});
