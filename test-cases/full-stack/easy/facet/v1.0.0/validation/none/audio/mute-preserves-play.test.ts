// Facet — audio/mute-preserves-play: with sound muted from the mute key, the
// same drive reaches the same place it reaches unmuted.
//
// specs/ui.md, under Audio: "Muting and the first-interaction unlock belong to
// the runtime. The game binds the `mute` action to the runtime's mute bit and
// toggles it from any screen, then mirrors that bit into `state.muted` every
// frame. The game stays fully playable with sound muted." The last sentence is
// this point, and "fully playable" is read the only way it can be decided
// without opinion: a muted round is the SAME round.
//
// WHAT IS COMPARED, AND WHAT IS NOT. Two harnesses are stood up from the same
// seed and driven through the identical scenario — a board carrying one planted
// run, the cursor's cell selected with `confirm`, the swap beside it requested,
// and its chain carried to the end. One of them presses the key
// specs/controls.md binds to `mute` first. Afterwards the board, `screen`,
// `phase`, `chainStep`, `score`, `levelScore`, `level`, `lastCleared`,
// `lastPoints`, `legalSwap`, the cursor and the selection all have to agree, and
// so do the frames the drive took and the game time it covered; `muted` is the
// one field entitled to differ.
//
// SILENCE ITSELF IS NOT READ, deliberately. specs/ui.md puts muting on the
// RUNTIME rather than on the game, so a muted frame is entitled to raise its cue
// and let the runtime's own bus zero it — and under this engine that bus is a
// layer inside the build, whose master gain nothing outside it can see.
// Asserting that a muted drive made no sound would fail a build that muted
// exactly as the specification says to. What is asserted is the game, which is
// what the sentence is about.
//
// WHY THE COUNTERS ARE READ FROM AN ORIGIN RATHER THAN ABSOLUTELY. Reaching the
// mute bit costs the muted drive a key press, and a press is a frame the other
// drive never spends. So each drive records `frame()` and the snapshot's
// `simTime` at the instant its board is posed, and what is compared is the
// frames taken and the game time covered SINCE that moment.
//
// NEITHER RESTING VALUE IS ASSUMED. The specification never says which way the
// runtime's mute bit rests when a build opens, so each drive is brought to the
// state it wants with at most one press of the toggle and then checked, rather
// than being assumed to start unmuted.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertTrue,
} from "../assert";
import {
  assertBoardEquals,
  hasAnyRun,
  maximalRuns,
  quietRowsWithEscape,
  swapIsLegal,
  swapped,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  captureReplay,
  createHarness,
  loadBoard,
  resolveChain,
  type Harness,
} from "../harness";
import type { FacetSnapshot } from "../surface";

/** Three rubies one exchange short of a run in row 3, clear of the filler's corner. */
const RUN_CELLS: readonly PlacedToken[] = [
  { col: 3, row: 3, token: "R0" },
  { col: 4, row: 3, token: "R0" },
  { col: 5, row: 2, token: "R0" },
];

/** The cell the waiting ruby sits on, and the cell the swap drops it into. */
const FROM: CellRef = { col: 5, row: 2 };
const TO: CellRef = { col: 5, row: 3 };

/**
 * Decimal places the two drives' elapsed game time is compared to.
 *
 * NOT a specification figure. Each drive sums the same frame deltas over the
 * same number of frames, so the two spans are the same number; the tolerance is
 * there so a difference in the last bits of a floating-point sum is not read as
 * a difference in play.
 */
const TIME_DIGITS = 9;

/** What one drive of the scenario reached, measured from the moment it was posed. */
interface Drive {
  /** Frames run since the board was posed. */
  frames: number;
  /** Game time covered since the board was posed, in seconds. */
  seconds: number;
  /** Chain steps the settle took. */
  steps: number;
  /** The board it ended on, in specs/board.md's notation. */
  board: string[];
  /** The state it settled in. */
  snapshot: FacetSnapshot;
}

let plain: Harness;

beforeEach(async () => {
  plain = await createHarness();
});

afterEach(async () => {
  await plain.dispose();
});

/**
 * Bring a build's mute bit to `want` with at most one press of the bound key,
 * and prove it got there.
 *
 * The toggle is what specs/controls.md fixes ("`mute` — Toggles the runtime's
 * mute bit"), and the resting value is fixed nowhere, so the state is reached
 * rather than assumed. A frame follows the press because specs/instrumentation.md
 * has the game mirror the bit into `muted` every frame.
 */
async function setMuted(h: Harness, want: boolean): Promise<void> {
  if ((await h.snapshot()).muted !== want) {
    await h.tapAction("mute");
    await h.advance(1);
  }
  assertEqual(
    (await h.snapshot()).muted,
    want,
    "the mute bit the drive runs under",
  );
}

/** Drive the whole scenario on one harness, muted or not, and report where it got. */
async function drive(h: Harness, muted: boolean): Promise<Drive> {
  // A real gesture first, so a build that withholds audio until the player has
  // interacted is in the same state in both drives.
  await h.armAudio();
  await setMuted(h, muted);

  await loadBoard(h, quietRowsWithEscape(RUN_CELLS));
  const originFrame = h.frame();
  const originTime = (await h.snapshot()).simTime;

  // Select the cursor's cell, then swap into the cell beside it. Each `confirm`
  // lands on a frame of its own.
  await h.debug.setCursor(FROM.col, FROM.row);
  await h.advance(1);
  await h.tapAction("confirm");
  assertDeepEqual(
    (await h.snapshot()).selection,
    FROM,
    "the cell `confirm` selected",
  );

  await h.debug.setCursor(TO.col, TO.row);
  await h.advance(1);
  await h.tapAction("confirm");
  assertEqual(
    (await h.snapshot()).phase,
    "resolving",
    "the phase the accepted swap opened",
  );

  const settled = await resolveChain(h);
  assertTrue(settled.settled, "the chain returned to idle within the cap");

  return {
    frames: h.frame() - originFrame,
    seconds: settled.snapshot.simTime - originTime,
    steps: settled.steps,
    board: await h.board(),
    snapshot: settled.snapshot,
  };
}

it("reaches the same board, score, phase and game time with sound muted", async () => {
  const posed = quietRowsWithEscape(RUN_CELLS);
  // The fixture is what it claims before either build is asked anything.
  assertEqual(hasAnyRun(posed), false, "a maximal run on the posed board");
  assertEqual(
    swapIsLegal(posed, FROM, TO),
    true,
    "the scenario's exchange is legal under R1 and R3",
  );
  assertLength(
    maximalRuns(swapped(posed, FROM, TO)),
    1,
    "maximal runs the exchange produces",
  );

  const heard = await drive(plain, false);

  const silent = await createHarness();
  try {
    const quiet = await captureReplay(silent, "muted", () =>
      drive(silent, true),
    );

    // The one field entitled to differ, on both sides, so the comparison below
    // is between a muted drive and an unmuted one rather than between two alike.
    assertEqual(
      heard.snapshot.muted,
      false,
      "the mute bit the sounding drive ran under",
    );
    assertEqual(
      quiet.snapshot.muted,
      true,
      "the mute bit the silent drive ran under",
    );

    // The board, cell for cell.
    assertBoardEquals(
      quiet.board,
      heard.board,
      "the board the muted drive reached",
    );

    // Every figure the round is played for.
    assertEqual(quiet.snapshot.screen, heard.snapshot.screen, "the screen");
    assertEqual(quiet.snapshot.phase, heard.snapshot.phase, "the phase");
    assertEqual(
      quiet.snapshot.chainStep,
      heard.snapshot.chainStep,
      "the chain step",
    );
    assertEqual(quiet.snapshot.score, heard.snapshot.score, "the score");
    assertEqual(
      quiet.snapshot.levelScore,
      heard.snapshot.levelScore,
      "the level score",
    );
    assertEqual(quiet.snapshot.level, heard.snapshot.level, "the level");
    assertEqual(
      quiet.snapshot.lastCleared,
      heard.snapshot.lastCleared,
      "the cells the last step cleared",
    );
    assertEqual(
      quiet.snapshot.lastPoints,
      heard.snapshot.lastPoints,
      "the points the last step scored",
    );
    assertEqual(
      quiet.snapshot.legalSwap,
      heard.snapshot.legalSwap,
      "whether a legal swap remains",
    );
    assertDeepEqual(quiet.snapshot.cursor, heard.snapshot.cursor, "the cursor");
    assertDeepEqual(
      quiet.snapshot.selection,
      heard.snapshot.selection,
      "the selection",
    );

    // And the drive itself: the same chain, over the same frames, covering the
    // same span of game time.
    assertEqual(quiet.steps, heard.steps, "the chain steps the settle took");
    assertEqual(
      quiet.frames,
      heard.frames,
      "the frames the drive took from the posed board",
    );
    assertCloseTo(
      quiet.seconds,
      heard.seconds,
      TIME_DIGITS,
      "the game time the drive covered from the posed board",
    );
  } finally {
    await silent.dispose();
  }
});
