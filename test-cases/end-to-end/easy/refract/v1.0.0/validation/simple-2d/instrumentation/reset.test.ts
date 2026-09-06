// Refract — instrumentation/reset: reset returns the game to its title-screen
// values.
//
// specs/instrumentation.md, of `reset(state)`: every declared field goes back
// to its title-screen value — the title with its first menu item highlighted,
// mode "campaign", no board in play, every beam empty, no trace live, the
// pointer reported as up, simTime 0, campaign progress cleared (no board
// solved, only the opening board unlocked), cascade progression back to
// solvedCount 0 and tier 1 — while `muted` is untouched, because the runtime
// owns muting.
//
// The check DIRTIES everything before resetting, so each restored value is a
// real restoration: it really solves campaign board 1 (through the title
// menu, the select screen, and the routes derived from
// specs/campaign-boards.md), poses a cascade run in progress through
// `setMode`, `setSolvedCount` and `setTier` with a board in play and a trace
// live on it, and toggles mute — then resets and holds the snapshot against
// the whole title-state list, reading it before any frame runs so simTime is
// the pose's own 0.
//
// The campaign precondition is read BEFORE the mode switch. Whether campaign
// progress survives entering the other mode is
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
  assertNotNull,
  assertNull,
} from "../assert";
import { GEO_3X3 } from "../fixtures";
import {
  captureStill,
  createHarness,
  driveCourse,
  loadBoard,
  nodeCenter,
  poseCascadeRun,
  resetTo,
  startCampaign,
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

it("restores every title-screen value after progress in both modes", async () => {
  // Dirty everything. Campaign: enter and solve board 1, so a board is
  // recorded solved and a second is unlocked. Cascade: pose a run in progress
  // with a board in play and a trace live on it. Then toggle mute, so
  // "untouched" is observable.
  await resetTo(h);
  await startCampaign(h);
  await driveCourse(h, 1);

  const campaignDirty = h.snapshot();
  assertDeepEqual(
    campaignDirty.solvedBoards,
    [0],
    "precondition: campaign board 1 is recorded solved",
  );
  assertEqual(
    campaignDirty.unlockedCount,
    2,
    "precondition: solving board 1 unlocked board 2",
  );

  poseCascadeRun(h, RUN_COUNT);
  const board = await loadBoard(h, GEO_3X3);
  const emitter = nodeCenter(0, 0, board.cols, board.rows);
  h.debug.pointerDown(emitter.x, emitter.y);
  const dirty = h.snapshot();
  assertEqual(dirty.mode, "cascade", "precondition: the cascade run is posed");
  assertEqual(
    dirty.solvedCount,
    RUN_COUNT,
    "precondition: the run holds solves to clear",
  );
  assertEqual(dirty.tier, 2, "precondition: the run holds a climbed tier");
  assertNotNull(dirty.tracing, "precondition: a trace is live");
  await tapAction(h, "mute");
  const mutedBefore = h.snapshot().muted;

  // The reset, and the snapshot the pose itself left — read before any frame
  // runs, so simTime is the restored 0 and not a frame's tick.
  h.debug.reset();
  const title = h.snapshot();
  await h.advance(1);
  captureStill(h, "title");

  assertEqual(title.screen, "title", "reset restores the title screen");
  assertEqual(title.menuIndex, 0, "the first menu item is highlighted");
  assertEqual(title.mode, "campaign", "mode goes back to campaign");
  assertEqual(title.board.nodes.length, 0, "no board in play");
  assertNull(title.tracing, "no trace is live");
  for (const [channel, beam] of Object.entries(title.beams)) {
    assertEqual(beam.cells.length, 0, `every beam is empty (${channel})`);
  }
  assertEqual(title.pointer.down, false, "the pointer is reported as up");
  assertEqual(title.simTime, 0, "simTime is 0");
  assertDeepEqual(title.solvedBoards, [], "no board is recorded solved");
  assertEqual(title.unlockedCount, 1, "only the opening board is unlocked");
  assertEqual(title.boardIndex, 0, "boardIndex is back at rest");
  assertEqual(title.selectIndex, 0, "selectIndex is back at rest");
  assertEqual(title.solvedCount, 0, "cascade solvedCount is back to 0");
  assertEqual(title.tier, 1, "cascade tier is back to 1");
  assertEqual(
    title.muted,
    mutedBefore,
    "muted is untouched — the runtime owns muting",
  );
});
