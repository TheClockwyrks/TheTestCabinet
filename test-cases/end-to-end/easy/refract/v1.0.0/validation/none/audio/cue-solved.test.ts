// Refract — audio/cue-solved: the frame the board becomes solved carries the
// solved cue on top of the completing move's own pair.
//
// Cue NAMES are not observable outside an engineless build (see
// audio/cue-connect for the doctrine), and every solving move is also a segment
// add that completes the last open channel — a beam runs emitter to emitter, so
// a complete beam cannot be extended further and the final channel completes on
// the solving move itself. The solving frame therefore lawfully carries THREE
// cues at once (specs/ui.md: "a frame that raises more than one of them plays
// each of those once"), and presence alone cannot tell a build that plays the
// solved cue from one that plays only the other two. What can: each cue is one
// defined sound, emitting the same number of sources every time it plays, so a
// frame playing connect + channel-complete + solved emits strictly more sound
// than a frame playing connect + channel-complete alone. The check drives both
// on one board — the triangle's completing move first (board still open), then
// the square's completing move, which solves it — and holds the solving frame's
// emission count strictly above the earlier completing frame's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { R2_FOREIGN } from "../fixtures";
import {
  captureReplay,
  createHarness,
  loadBoard,
  mouseTrace,
  watchCues,
  type Harness,
  type TimedCue,
} from "../harness";

/** Half a second between the two beams, proving the pause is silent. */
const GAP_TICKS = 30;

/** Half a second recorded after the solve, so the replay shows the outcome. */
const AFTER_TICKS = 30;

/** How many sounds landed on `frame`. */
function soundsOn(cues: readonly TimedCue[], frame: number): number {
  return cues.filter((cue) => cue.frame === frame).length;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds more on the solving move than on the earlier channel-completing move", async () => {
  // Triangle straight across the top, then square on two diagonals of
  // different blocks: the square's last move solves the board
  // (specs/beams.md R9), and the triangle's last move completed a channel
  // while the board stayed open — the comparison frame.
  const board = await loadBoard(h, R2_FOREIGN);
  await h.armAudio();

  const played = watchCues(h);
  const solved = await captureReplay(h, "solve", async () => {
    await mouseTrace(h, board, [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 2, row: 0 },
    ]);
    // The release frame ran last; the completing add was the frame before it.
    const completingFrame = h.frame() - 1;
    const betweenStart = played.length;
    await h.advance(GAP_TICKS);
    const betweenEnd = played.length;

    await mouseTrace(h, board, [
      { col: 0, row: 2 },
      { col: 1, row: 1 },
      { col: 2, row: 2 },
    ]);
    // The solving add was the frame before the release's.
    const measured = {
      completingFrame,
      betweenStart,
      betweenEnd,
      solvingFrame: h.frame() - 1,
      cues: [...played],
    };

    await h.advance(AFTER_TICKS);
    return measured;
  });

  // The board really became solved on that move.
  assertEqual((await h.snapshot()).solved, true, "the board is solved");

  assertEqual(
    solved.betweenEnd,
    solved.betweenStart,
    "no sound in the pause between the two beams",
  );
  const completing = soundsOn(solved.cues, solved.completingFrame);
  const solving = soundsOn(solved.cues, solved.solvingFrame);
  assertGreaterThan(
    solving,
    completing,
    `the solving frame plays the solved cue on top of the completing move's ` +
      `pair (${completing} sound(s) on the channel-completing frame)`,
  );
});
