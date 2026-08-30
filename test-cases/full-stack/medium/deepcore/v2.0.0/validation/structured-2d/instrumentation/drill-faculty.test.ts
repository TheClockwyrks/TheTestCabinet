// Deepcore — instrumentation.drill-faculty. STUB: NOT YET AUTHORED.
//
// With the drill off no cut starts or progresses
//
// setMinerDrill(false) stops the drill cutting: no cell loses health, no cell
// breaks, nothing is banked and no drill hit spends fuel, while the miner
// still walks, falls, thrusts and takes damage exactly as it does with the
// drill running.
//
// Automated validation: hold the drill off over a held down cut and read the
// target cell health, the cargo and the fuel unchanged, then confirm the miner
// still falls and thrusts.
//
// `test-case.toml` declares this suite as `instrumentation/drill-faculty.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (inert (replay)) around the drive.

import { test } from "vitest";

test("With the drill off no cut starts or progresses", () => {
  throw new Error(
    "Deepcore validator `instrumentation/drill-faculty` is declared in test-case.toml but has not been authored yet.",
  );
});
