// Deepcore — fuel.life-support-stops-at-the-surface. STUB: NOT YET AUTHORED.
//
// Life support costs nothing at the surface
//
// The life-support drain is charged only below the surface ground line, so a
// miner standing in the camp with nothing held spends no fuel at all.
//
// Automated validation: stand the miner idle on the camp ground with nothing
// held, advance a long span and read the fuel unchanged.
//
// `test-case.toml` declares this suite as `fuel/life-support-stops-at-the-surface.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (camp (replay)) around the drive.

import { test } from "vitest";

test("Life support costs nothing at the surface", () => {
  throw new Error(
    "Deepcore validator `fuel/life-support-stops-at-the-surface` is declared in test-case.toml but has not been authored yet.",
  );
});
