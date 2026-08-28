// Refract — instrumentation/reset: after progress in both modes, reset
// returns the game to its title-screen values.
//
// Everything is dirtied FIRST, through the game's own systems: campaign board
// 1 really solved (driveCourse), then — via `startMode`, which leaves both
// progressions standing — one generated cascade board really solved, the next
// board opened with a live partial trace on it, and the engine muted through
// the real mute action. Then `reset({seed: 7})`, and the state is held
// against the full title-state list in specs/instrumentation.md: title with
// menuIndex 0, mode campaign, no board in play, every beam empty, no trace
// live, the pointer up, simTime restored to 0, campaign progress cleared,
// cascade progress back to solvedCount 0 and tier 1, rngState seeded from
// options.seed — and muted UNTOUCHED, because the runtime owns muting.
//
// One reading is worth naming: a screen-changing pose lands by the end of the
// next advanced frame (the shared convention), and simTime accumulates the
// delta of EVERY update whatever the screen — so the read one landing frame
// after reset sees simTime restored to zero plus at most that one frame.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
  assertNotNull,
  assertNull,
  assertTruthy,
} from "../assert";
import {
  boardFromSnapshot,
  captureStill,
  createHarness,
  driveCourse,
  pressCell,
  resetTo,
  seconds,
  tapAction,
  traceBeams,
  type Harness,
} from "../harness";
import { solve } from "../solver";
import { DEFAULT_SEED } from "../surface";

/** The live state's rngState — a field the snapshot deliberately omits. */
function rngState(h: Harness): unknown {
  return (h.state as unknown as { rngState?: unknown }).rngState;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("restores the title-screen values after progress in both modes, leaving muted alone", async () => {
  // Campaign progress: board 1 really solved.
  await driveCourse(h, 1, 1);
  assertContains(h.snapshot().solvedBoards, 0, "campaign board 1 is solved");

  // Cascade progress, without disturbing the campaign's: startMode leaves the
  // progression of both modes as it stands (specs/instrumentation.md).
  h.debug.startMode("cascade");
  await h.advance(1);
  const arrival = h.snapshot();
  assertEqual(arrival.screen, "playing", "cascade opens on playing");
  const result = solve(boardFromSnapshot(arrival));
  assertEqual(
    result.status,
    "solved",
    "the spec-derived solver cracks the generated board",
  );
  if (result.status !== "solved") return;
  traceBeams(h, result.beams);
  assertEqual(h.snapshot().solved, true, "the cascade board is solved");
  await h.advance(1);
  assertEqual(h.snapshot().solvedCount, 1, "cascade really progressed");

  // A board in play with a live trace: NEXT BOARD, then press an emitter and
  // leave the trace up.
  await tapAction(h, "confirm");
  const next = h.snapshot();
  assertEqual(next.screen, "playing", "the next cascade board is up");
  const emitter = next.board.nodes.find((node) => node.kind === "emitter");
  assertTruthy(emitter, "the generated board carries an emitter");
  if (emitter === undefined) return;
  pressCell(h, { col: emitter.col, row: emitter.row });
  assertNotNull(h.snapshot().tracing, "a trace is live before the reset");

  // Mute through the real registered action; the runtime owns the bit and
  // reset must leave it alone.
  await tapAction(h, "mute");
  assertEqual(h.snapshot().muted, true, "muted before the reset");

  const before = h.snapshot();
  assertGreaterThan(before.simTime, 0, "simTime accumulated before the reset");

  // The reset under test, and the frame that lands it.
  h.debug.reset({ seed: 7 });
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

  // options.seed seeds rngState (specs/state.md: a reset with a seed sets it).
  assertEqual(rngState(h), 7, "rngState seeded from options.seed");

  // muted is untouched; the runtime owns muting.
  assertEqual(after.muted, true, "reset leaves muted untouched");
});

it("a reset naming no seed seeds rngState with DEFAULT_SEED", async () => {
  await resetTo(h, 7);
  assertEqual(rngState(h), 7, "the named seed lands first");

  await resetTo(h);
  assertEqual(
    rngState(h),
    DEFAULT_SEED,
    "options.seed defaults to DEFAULT_SEED (1)",
  );
});
