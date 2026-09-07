// Refract — instrumentation/reset: `reset` returns every declared field to its
// title-screen value and leaves `muted` alone.
//
// A RESET THAT ONLY LOOKS CLEAN IS THE FAILURE MODE. Read on a fresh page,
// every field is at its title value whether or not `reset` did anything — so
// the state is dirtied FIRST, in both modes: campaign board 1 is solved through
// real play (solvedBoards and unlockedCount move, and campaign progress has no
// pose), a cascade run in progress is posed through `setMode`,
// `setSolvedCount` and `setTier` (specs/instrumentation.md) with a board in
// play and a trace live on it, and the mute toggle is pressed. Only then does
// `reset()` run, and the snapshot is held against the full title-state list in
// specs/instrumentation.md — with `muted`, which the runtime owns and reset
// must not touch, required to keep whatever value the press left it.
//
// The campaign precondition is read BEFORE the mode switch. Whether campaign
// progress survives entering another mode is
// `campaign/campaign-progress-persists`'s requirement, and reading
// `solvedBoards` after the switch would make this item fail on a build that
// misses that one. And `muted` is compared against whatever the mute toggle
// left rather than against `true`, because the binding that turns muting on is
// `screens/mute`'s requirement; what reset owes is that it leaves the bit
// alone.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThanOrEqual,
  assertNotNull,
  assertNull,
} from "../assert";
import { GEO_3X3 } from "../fixtures";
import {
  captureStill,
  center,
  createHarness,
  driveCourse,
  fireAction,
  loadBoard,
  poseCascadeRun,
  type Harness,
} from "../harness";

/** A run in progress: past the first climb, so tier 2 stands to be cleared. */
const RUN_COUNT = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("restores every declared field to its title-screen value, muted untouched", async () => {
  // Dirty the campaign: really solve board 1 (progress has no pose).
  const walk = await driveCourse(h, 1);
  assertDeepEqual(
    walk.final.solvedBoards,
    [0],
    "solving board 1 records it solved (the state to be cleared)",
  );
  assertGreaterThanOrEqual(
    walk.final.unlockedCount,
    2,
    "solving board 1 unlocks past the opening board",
  );

  // Dirty the cascade: pose a run in progress, a board in play, and a trace
  // live on it.
  await poseCascadeRun(h, RUN_COUNT);
  const board = await loadBoard(h, GEO_3X3);
  const emitter = center(board, { col: 0, row: 0 });
  await h.debug.pointerDown(emitter.x, emitter.y);
  const dirty = await h.snapshot();
  assertEqual(dirty.mode, "cascade", "the cascade run is posed");
  assertEqual(dirty.solvedCount, RUN_COUNT, "the run holds solves to clear");
  assertEqual(dirty.tier, 2, "the run holds a climbed tier to clear");
  assertNotNull(dirty.tracing, "a trace is live before the reset");

  // Dirty the mute bit if the build binds the habitual key; whatever the press
  // left is what reset must leave.
  await fireAction(h, "mute");
  const mutedBefore = (await h.snapshot()).muted;

  await h.debug.reset();

  // The full title-state list, read before any frame runs (simTime is 0 at
  // the reset itself). The frame after the read is what puts the title on the
  // canvas, and the evidence is written before the assertions so a failing
  // check still leaves the picture that shows why.
  const reset = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "title");

  assertEqual(reset.screen, "title", "the title screen");
  assertEqual(reset.menuIndex, 0, "its first menu item highlighted");
  assertEqual(reset.mode, "campaign", "mode back to campaign");
  assertEqual(reset.board.nodes.length, 0, "no board in play");
  assertNull(reset.tracing, "no trace live");
  assertEqual(reset.pointer.down, false, "the pointer reported as up");
  assertEqual(reset.simTime, 0, "simTime at 0");
  assertEqual(reset.boardIndex, 0, "boardIndex cleared");
  assertDeepEqual(reset.solvedBoards, [], "no board recorded solved");
  assertEqual(reset.unlockedCount, 1, "only the opening board unlocked");
  assertEqual(reset.selectIndex, 0, "selectIndex cleared");
  assertEqual(reset.solvedCount, 0, "cascade progression back to 0 solved");
  assertEqual(reset.tier, 1, "and back to tier 1");
  for (const [channel, beam] of Object.entries(reset.beams)) {
    assertDeepEqual(beam.cells, [], `every beam empty (${channel})`);
  }
  assertEqual(reset.muted, mutedBefore, "muted is untouched by reset");
});
