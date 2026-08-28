// Refract — audio/cue-connect: a cue sounds on the frame a segment is added,
// and on no frame before it.
//
// WHAT CAN BE READ FROM OUTSIDE AN ENGINELESS BUILD. Under an engine the game
// asks the cue bus for `CUES.connect` by name and the bus announces the play.
// There is no bus here — specs/ui.md hands the whole audio layer to the build —
// so what is observed is the sound itself: `audio-init.js` watches the two doors
// a browser can emit sound through, and the harness attributes each emission to
// the frame that produced it. The cue's NAME is not observable, so what is
// asserted is that the segment-add frame sounded and that nothing sounded on the
// half second of held board, the trace-beginning press, or any frame before the
// add; whether the sound is the right one of the five is the reviewer's, by ear.
//
// THE MOVE IS MADE WITH THE REAL MOUSE, never with the surface's pointer
// operations: the cue is "played on the frame its event happens, from `update`"
// (specs/ui.md), off the pointer samples the build's own input layer reads each
// frame, so the check hands the build a genuine pointer and drives one frame per
// sample. The press that BEGINS the trace adds no segment (specs/controls.md,
// "Beginning a trace") and so must stay silent — the nearest frame "before" the
// add there is.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { R3_REDRAW } from "../fixtures";
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
} from "../harness";

/** Half a second of posed board recorded before the press, proving silence. */
const QUIET_TICKS = 30;

/** Half a second recorded after the release, so the replay shows the segment. */
const AFTER_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds on the frame the segment is added, and not before it", async () => {
  // A 3x1 board whose first segment neither completes the beam nor solves the
  // board, so the frame under test raises the connect event alone.
  const board = await loadBoard(h, R3_REDRAW);
  await h.armAudio();

  const played = watchCues(h);
  const added = await captureReplay(h, "hit", async () => {
    await h.advance(QUIET_TICKS);
    const beforePress = played.length;

    const start = center(board, { col: 0, row: 0 });
    await mousePress(h, start.x, start.y);
    const afterPress = played.length;

    const target = center(board, { col: 1, row: 0 });
    await mouseGlide(h, target.x, target.y);
    // Read HERE, on the frame that consumed the move: the frame number and the
    // sounds emitted by then are what the assertions below hold.
    const measured = {
      beforePress,
      afterPress,
      frame: h.frame(),
      cues: [...played],
    };

    await mouseRelease(h);
    await h.advance(AFTER_TICKS);
    return measured;
  });

  // The segment was really added, by the build's own rules.
  assertDeepEqual(
    (await h.snapshot()).beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ],
    "the traced segment is on the beam",
  );

  assertEqual(added.beforePress, 0, "no sound on the held board");
  assertEqual(
    added.afterPress,
    0,
    "no sound on the press that begins the trace",
  );
  assertGreaterThan(added.cues.length, 0, "a sound on the segment-add frame");
  assertDeepEqual(
    added.cues.map((cue) => cue.frame),
    added.cues.map(() => added.frame),
    "every sound lands on the segment-add frame",
  );
});
