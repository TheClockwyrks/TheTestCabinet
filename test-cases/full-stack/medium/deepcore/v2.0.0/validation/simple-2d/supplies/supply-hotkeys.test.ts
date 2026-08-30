// Deepcore — supplies.supply-hotkeys. STUB: NOT YET AUTHORED.
//
// The number keys use the supply of that number
//
// The hotkeys Digit1 through Digit6 during live play use the field supply of
// that number, in the order specs/items.md lists them, so 1 is Dynamite and 6
// is Emergency Fuel.
//
// Automated validation: pose one of each supply, press each hotkey in turn and
// read the matching count fall by one.
//
// `test-case.toml` declares this suite as `supplies/supply-hotkeys.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (keys (replay)) around the drive.

import { test } from "vitest";

test("The number keys use the supply of that number", () => {
  throw new Error(
    "Deepcore validator `supplies/supply-hotkeys` is declared in test-case.toml but has not been authored yet.",
  );
});
