// Refract — instrumentation/reset: after progress in both modes, reset
// returns the game to its title-screen values.
//
// Everything is dirtied FIRST: campaign board 1 really solved (driveCourse),
// then — without a reset, so both progressions stand — a cascade run in
// progress posed through `setMode`, `setSolvedCount` and `setTier`
// (specs/instrumentation.md), a board posed into play with a live partial
// trace on it, and the engine muted through the real mute action. Then
// `reset()`, and the state is held against the full title-state list in
// specs/instrumentation.md: title with menuIndex 0, mode campaign, no board
// in play, every beam empty, no trace live, the pointer up, simTime restored
// to 0, campaign progress cleared, cascade progress back to solvedCount 0 and
// tier 1 — and muted UNTOUCHED, because the runtime owns muting.
//
// One reading is worth naming: a screen-changing pose lands by the end of the
// next advanced frame (the shared convention), and simTime accumulates the
// delta of EVERY update whatever the screen — so the read one landing frame
// after reset sees simTime restored to zero plus at most that one frame.
//
// The campaign precondition is read BEFORE the mode switch. Whether campaign
// progress survives entering the other mode is
// `campaign/campaign-progress-persists`'s requirement, and reading
// `solvedBoards` after the switch would make this item fail on a build that
// misses that one. And `muted` is compared against whatever the mute toggle
// left rather than against `true`, because the binding that turns muting on is
// `screens/mute`'s requirement; what reset owes is that it leaves the bit
// alone.
//
// A DELIBERATE ENGINE DIFFERENCE, not a drift: this engine's branch of
// specs/state.md fixes the no-board-in-play board as `cols` 0, `rows` 0 and no
// nodes, so both dimensions are asserted here. The simple-2d branch fixes only
// that no board is in play, and its reference reports `{cols: 1, rows: 1}`
// with no nodes, so the same two assertions there would fail a spec-honoring
// build. `nodes` empty is the clause all three engines share.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
  assertNotNull,
  assertNull,
} from "../assert";
import { GEO_3X3 } from "../fixtures";
import {
  captureStill,
  createHarness,
  driveCourse,
  loadBoard,
  poseCascadeRun,
  pressCell,
  seconds,
  tapAction,
  type Harness,
} from "../harness";

/** A run in progress: past the first climb, so tier 2 stands to be cleared. */
const RUN_COUNT = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("restores the title-screen values after progress in both modes, leaving muted alone", async () => {
  // Campaign progress: board 1 really solved.
  await driveCourse(h, 1);
  assertContains(h.snapshot().solvedBoards, 0, "campaign board 1 is solved");

  // Cascade progress, without disturbing the campaign's: the run is posed,
  // and choosing a mode leaves the other mode's progression as it stands
  // (specs/modes/campaign.md). A board in play with a live trace: press an
  // emitter and leave the trace up.
  poseCascadeRun(h, RUN_COUNT);
  await loadBoard(h, GEO_3X3);
  pressCell(h, { col: 0, row: 0 });
  const dirty = h.snapshot();
  assertEqual(dirty.mode, "cascade", "the cascade run is posed");
  assertEqual(dirty.solvedCount, RUN_COUNT, "the run holds solves to clear");
  assertEqual(dirty.tier, 2, "the run holds a climbed tier to clear");
  assertNotNull(dirty.tracing, "a trace is live before the reset");

  // Mute through the real registered action; the runtime owns the bit and
  // reset must leave it alone, whichever way the toggle left it.
  await tapAction(h, "mute");
  const mutedBefore = h.snapshot().muted;

  const before = h.snapshot();
  assertGreaterThan(before.simTime, 0, "simTime accumulated before the reset");

  // The reset under test, and the frame that lands it.
  h.debug.reset();
  await h.advance(1);
  captureStill(h, "title");
  const after = h.snapshot();

  // The full title-state list from specs/instrumentation.md.
  assertEqual(after.screen, "title", "the title screen");
  assertEqual(after.menuIndex, 0, "the first menu item is highlighted");
  assertEqual(after.mode, "campaign", "mode back to campaign");
  assertEqual(after.board.cols, 0, "no board in play: cols");
  assertEqual(after.board.rows, 0, "no board in play: rows");
  assertDeepEqual(after.board.nodes, [], "no board in play: nodes");
  assertDeepEqual(after.beams, {}, "every beam empty");
  assertNull(after.tracing, "no trace live");
  assertEqual(after.pointer.down, false, "the pointer reported as up");
  // Restored to 0, then at most the one landing frame accumulated.
  assertLessThanOrEqual(
    after.simTime,
    seconds(1) + 1e-9,
    "simTime restored to 0 (read one landing frame after reset)",
  );
  assertEqual(after.boardIndex, 0, "campaign progress cleared: boardIndex");
  assertDeepEqual(
    after.solvedBoards,
    [],
    "campaign progress cleared: no board is recorded solved",
  );
  assertEqual(
    after.unlockedCount,
    1,
    "campaign progress cleared: only the opening board is unlocked",
  );
  assertEqual(after.selectIndex, 0, "campaign progress cleared: selectIndex");
  assertEqual(after.solvedCount, 0, "cascade progress back to solvedCount 0");
  assertEqual(after.tier, 1, "cascade progress back to tier 1");

  // muted is untouched; the runtime owns muting.
  assertEqual(after.muted, mutedBefore, "reset leaves muted untouched");
});
