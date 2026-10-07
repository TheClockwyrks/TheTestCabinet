// screens/opens-on-title — the game opens on the title screen, with the idle run.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`title`"): "The game opens
// here, and the debug surface's `reset` returns here." specs/ui.md ("Menu
// navigation"): "`menuIndex` is `0` on entering every screen". specs/state.md:
// "Off the run, on `title` and `howto`, the run's fields hold their idle
// values: tick `0`, level `1`, no experience, no kills, the lamplighter at the
// world origin facing right with `BASE_MAX_HP` (`100`) health, no weapons, no
// passives, nothing alive, nothing dropped, no offers, no level-ups earned, no
// chest result, the spawn timer at `0`, no events fired, and the next id `0`",
// which `idleRun()` restates with the derived fields each formula gives an
// empty loadout.
//
// WHY THE WORLD IS POSED AS IT IS. Nothing is posed at all, because the
// requirement is about the state the build STOOD THE GAME UP IN: "the game
// opens here" is a fact about a fresh session rather than about what a `reset`
// puts back. The harness reads that snapshot before its own opening reset, and
// this check reads it from there. A build whose surface cannot be driven has no
// such reading, and the point fails on it rather than passing on the reset's.
//
// THE TOLERANCE. None: a screen name, an index, and the idle run's figures are
// exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, fail } from "../assert";
import {
  captureStill,
  createHarness,
  documentedRun,
  idleRun,
  type Harness,
  type WickSnapshot,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stands a fresh session on title with menuIndex 0 and the idle run", async () => {
  const opening: WickSnapshot | null = h.openingSnapshot;
  if (opening === null) {
    fail("a snapshot of the game the build stood up", h.surfaceFault);
  }
  await captureStill(h, "title");

  assertEqual(opening.screen, "title", "the screen the build opened on");
  assertEqual(opening.menuIndex, 0, "menuIndex on the screen it opened on");
  assertDeepEqual(
    documentedRun(opening.run),
    idleRun(),
    "the run a fresh session holds",
  );
});
