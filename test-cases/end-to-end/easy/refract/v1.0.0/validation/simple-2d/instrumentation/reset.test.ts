// Refract — instrumentation/reset: reset returns the game to its title-screen
// values.
//
// specs/instrumentation.md, of `reset(options)`: every declared field goes
// back to its title-screen value — the title with its first menu item
// highlighted, mode "campaign", no board in play, every beam empty, no trace
// live, the pointer reported as up, simTime 0, campaign progress cleared (no
// board solved, only the opening board unlocked), cascade progression back to
// solvedCount 0 and tier 1 — while `options.seed` seeds rngState, defaulting
// to DEFAULT_SEED (1), and `muted` is untouched, because the runtime owns
// muting.
//
// The first check DIRTIES everything before resetting, so each restored value
// is a real restoration: it really solves campaign board 1 (through the
// title menu, the select screen, and the routes derived from
// specs/campaign-boards.md), really solves one generated cascade board
// (proved solvable by the spec-derived solver), and toggles mute — then
// resets with seed 7 and holds the snapshot against the whole title-state
// list, reading it before any frame runs so simTime is the pose's own 0.
//
// The campaign precondition is read BEFORE the mode switch. Whether campaign
// progress survives entering the other mode is
// `campaign/campaign-progress-persists`'s requirement, and reading `solvedBoards` after the switch would make this
// item fail on a build that misses that one. And `muted` is compared against
// whatever the mute toggle left rather than against `true`, because the
// binding that turns muting on is `screens/mute`'s requirement; what reset
// owes is that it leaves the bit alone.
//
// The second check reads the seed BACK and then replays it.
// specs/instrumentation.md fixes what reset does to the generator exactly —
// "rngState becomes options.seed, or DEFAULT_SEED (1) when no seed is given" —
// and reports rngState on the snapshot, so the pose is verified by setting a
// value and reading it back, which a build ignoring options.seed fails. The
// determinism reading stays beside it for what the read-back does not cover:
// the same seed and the same calls reach the same state, so two resets with
// seed 7 must generate the same first cascade board, and a seedless reset must
// match a reset with DEFAULT_SEED (1). (A build that uses no randomness passes
// that second half vacuously, exactly as the spec allows.)

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  driveCourse,
  enterCascade,
  oracleBoard,
  resetTo,
  solveGenerated,
  startCampaign,
  startCascade,
  tapAction,
  type Harness,
} from "../harness";
import { boardToNotation } from "../notation";
import { DEFAULT_SEED } from "../surface";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("restores every title-screen value after progress in both modes", async () => {
  // Dirty everything. Campaign: enter through the real title menu and solve
  // board 1, so a board is recorded solved and a second is unlocked. Cascade:
  // enter and solve one generated board, so solvedCount moves off 0. Then
  // toggle mute, so "untouched" is observable.
  await resetTo(h, 5);
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

  await enterCascade(h);
  await solveGenerated(h, 1);
  await tapAction(h, "mute");

  const dirty = h.snapshot();
  assertEqual(
    dirty.solvedCount,
    1,
    "precondition: one cascade board is solved",
  );
  const mutedBefore = dirty.muted;

  // The reset, and the snapshot the pose itself left — read before any frame
  // runs, so simTime is the restored 0 and not a frame's tick.
  h.debug.reset({ seed: 7 });
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

it("seeds rngState from options.seed, defaulting to DEFAULT_SEED (1)", async () => {
  // The seed itself, read straight back off the snapshot.
  h.debug.reset({ seed: 7 });
  assertEqual(
    h.snapshot().rngState,
    7,
    "reset({seed: 7}) leaves rngState at 7",
  );
  h.debug.reset();
  assertEqual(
    h.snapshot().rngState,
    DEFAULT_SEED,
    "an omitted seed leaves rngState at DEFAULT_SEED (1)",
  );

  // The first cascade board generated after a reset, as notation: the same
  // seed and the same calls must reach the same state
  // (specs/instrumentation.md "A deterministic core").
  const firstCascadeBoard = async (seed?: number): Promise<string> => {
    if (seed === undefined) {
      h.debug.reset();
    } else {
      h.debug.reset({ seed });
    }
    await h.advance(1);
    const s = await startCascade(h);
    return boardToNotation(oracleBoard(s));
  };

  const seededOnce = await firstCascadeBoard(7);
  const seededAgain = await firstCascadeBoard(7);
  assertEqual(
    seededAgain,
    seededOnce,
    "reset({seed: 7}) twice generates the same first cascade board",
  );

  const seedless = await firstCascadeBoard(undefined);
  const seededDefault = await firstCascadeBoard(DEFAULT_SEED);
  assertEqual(
    seededDefault,
    seedless,
    "reset() seeds rngState with DEFAULT_SEED (1)",
  );
});
