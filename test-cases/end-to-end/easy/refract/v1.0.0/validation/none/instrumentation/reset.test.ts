// Refract — instrumentation/reset: `reset` returns every declared field to its
// title-screen value, seeds `rngState` from `options.seed`, and leaves `muted`
// alone.
//
// A RESET THAT ONLY LOOKS CLEAN IS THE FAILURE MODE. Read on a fresh page,
// every field is at its title value whether or not `reset` did anything — so
// the state is dirtied FIRST, in both modes, through real play: campaign board
// 1 is solved (solvedBoards and unlockedCount move), a cascade board is solved
// (solvedCount moves), and the mute toggle is pressed. Only then does
// `reset({ seed: 7 })` run, and the snapshot is held against the full
// title-state list in specs/instrumentation.md — with `muted`, which the
// runtime owns and reset must not touch, required to keep whatever value the
// press left it.
//
// THE SEED IS OBSERVED THROUGH THE ONE WINDOW THE SPEC OPENS: determinism.
// `rngState` is not a snapshot field; what the spec fixes is that the same seed
// and the same calls reproduce the same result exactly, and that an omitted
// seed means DEFAULT_SEED (1). So the same seed must generate the same cascade
// opening board twice, and `reset()` must open on the board `reset({ seed: 1 })`
// opens on. (A build that uses no randomness generates the same board every
// time and passes both, exactly as the spec allows.)

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThanOrEqual,
  assertNull,
} from "../assert";
import { DEFAULT_SEED } from "../constants";
import { boardToNotation } from "../notation";
import { solve } from "../solver";
import {
  boardFromSnapshot,
  captureStill,
  createHarness,
  drawBeams,
  driveCourse,
  fireAction,
  startCascade,
  type Harness,
} from "../harness";

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

  // Dirty the cascade: enter it and solve one generated board with the case's
  // own spec-derived solver.
  await startCascade(h);
  let snapshot = await h.snapshot();
  assertEqual(snapshot.screen, "playing", "cascade puts a board in play");
  const verdict = solve(boardFromSnapshot(snapshot));
  assertEqual(
    verdict.status,
    "solved",
    "the case's solver cracks the first cascade board",
  );
  if (verdict.status !== "solved") return;
  await drawBeams(h, verdict.beams);
  snapshot = await h.snapshot();
  assertEqual(snapshot.solvedCount, 1, "solving the board counts it");

  // Dirty the mute bit if the build binds the habitual key; whatever the press
  // left is what reset must leave.
  await fireAction(h, "mute");
  const mutedBefore = (await h.snapshot()).muted;

  await h.debug.reset({ seed: 7 });

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

it("seeds rngState from options.seed, defaulting to DEFAULT_SEED", async () => {
  // The same seed and the same calls reproduce the same result exactly, so two
  // runs from reset({ seed: 7 }) open the cascade on the same board.
  const opening = async (): Promise<string> => {
    await startCascade(h);
    const snapshot = await h.snapshot();
    assertEqual(snapshot.screen, "playing", "cascade puts a board in play");
    return boardToNotation(boardFromSnapshot(snapshot));
  };

  await h.debug.reset({ seed: 7 });
  const first = await opening();
  await h.debug.reset({ seed: 7 });
  const second = await opening();
  assertEqual(second, first, "the same seed opens on the same board");

  // An omitted seed means DEFAULT_SEED (1).
  await h.debug.reset();
  const unseeded = await opening();
  await h.debug.reset({ seed: DEFAULT_SEED });
  const seeded = await opening();
  assertEqual(
    unseeded,
    seeded,
    `an omitted seed defaults to DEFAULT_SEED (${DEFAULT_SEED})`,
  );
});
