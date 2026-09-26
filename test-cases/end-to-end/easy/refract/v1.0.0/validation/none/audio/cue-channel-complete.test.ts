// Refract — audio/cue-channel-complete: the frame a channel's beam becomes
// complete carries the channel-complete cue on top of that same move's connect.
//
// Cue NAMES are not observable outside an engineless build (see
// audio/cue-connect for the doctrine), and the completing move is itself a
// segment add, so its frame lawfully carries TWO cues at once: specs/ui.md,
// "a frame that raises more than one of them plays each of those once". Presence
// alone therefore cannot tell a build that plays both from one that plays only
// its connect. What can: each cue is one defined sound (specs/ui.md, "Define and
// play exactly the five cues in `CUES`"), so a given cue emits the same number
// of sources every time it plays, and a frame that plays connect AND
// channel-complete emits strictly more sound than a frame that plays connect
// alone. The check drives both frames on one board — a plain add, then the
// completing add — and holds the completing frame's emission count strictly
// above the plain one's.
//
// The board is two-channel, so completing the triangle leaves the board
// unsolved and no solved cue can leak into the completing frame's count.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { R2_FOREIGN } from "../fixtures";
import {
  captureReplay,
  center,
  createHarness,
  loadBoard,
  mouseGlide,
  mousePress,
  mouseRelease,
  watchCues,
  type Harness,
  type TimedCue,
} from "../harness";

/** Half a second of held trace between the two adds, proving silence. */
const GAP_TICKS = 30;

/** Half a second recorded after the release, so the replay shows the beam. */
const AFTER_TICKS = 30;

/** How many sounds landed on `frame`. */
function soundsOn(cues: readonly TimedCue[], frame: number): number {
  return cues.filter((cue) => cue.frame === frame).length;
}

let h: Harness;

beforeEach(async () => {
  // Armed at creation: this check counts what the build SOUNDED on two frames, and
  // the gesture that opens the build's audio is delivered before the opening
  // `reset` puts the state back. See audio/cue-connect for the whole argument.
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("sounds more on the completing add than on a plain add of the same beam", async () => {
  // Triangle along the top row: T(0,0)-t(1,0) is a plain add, and the move on
  // to T(2,0) threads the lens and reaches the second emitter — complete
  // (specs/beams.md R6, R7) — while the square channel keeps the board open.
  const board = await loadBoard(h, R2_FOREIGN);

  const played = watchCues(h);
  const completed = await captureReplay(h, "complete", async () => {
    const emitter = center(board, { col: 0, row: 0 });
    await mousePress(h, emitter.x, emitter.y);
    const lens = center(board, { col: 1, row: 0 });
    await mouseGlide(h, lens.x, lens.y);
    const plainFrame = h.frame();

    const afterPlain = played.length;
    await h.advance(GAP_TICKS);
    const afterGap = played.length;

    const far = center(board, { col: 2, row: 0 });
    await mouseGlide(h, far.x, far.y);
    // Read HERE, on the frame that consumed the completing move.
    const measured = {
      plainFrame,
      afterPlain,
      afterGap,
      completingFrame: h.frame(),
      cues: [...played],
    };

    await mouseRelease(h);
    await h.advance(AFTER_TICKS);
    return measured;
  });

  // The beam really became complete on that move, and the board stayed open.
  const after = await h.snapshot();
  assertEqual(
    after.beams.triangle?.complete,
    true,
    "the triangle beam is complete",
  );
  assertEqual(after.solved, false, "the square channel keeps the board open");

  assertEqual(
    completed.afterGap,
    completed.afterPlain,
    "no sound in the gap between the two adds",
  );
  const plain = soundsOn(completed.cues, completed.plainFrame);
  const completing = soundsOn(completed.cues, completed.completingFrame);
  assertGreaterThan(
    completing,
    plain,
    `the completing frame plays the channel-complete cue on top of its ` +
      `connect (${plain} sound(s) on the plain add)`,
  );
});
