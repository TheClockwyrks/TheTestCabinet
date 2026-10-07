// Refract — audio/cue-retract: a cue sounds on the frame a segment is removed,
// and on no frame between the add and the removal.
//
// The cue's NAME is not observable outside an engineless build (see
// audio/cue-connect for the doctrine), so what is asserted is the timing:
// backing the held pointer onto the node behind the live end removes the last
// segment (specs/controls.md, "Retracting"), the retract cue is "played on the
// frame its event happens, from `update`" (specs/ui.md), and the half second of
// held trace between the add and the retraction must stay silent — the add's own
// connect cue sounded earlier and is fenced off by that gap, so every sound
// after it belongs to the removal.
//
// The moves are the REAL mouse, one driven frame per sample, because the cue is
// played off the pointer samples the build's own input layer reads each frame.

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

/** Half a second of held trace between the add and the retraction. */
const GAP_TICKS = 30;

/** Half a second recorded after the release, so the replay shows the outcome. */
const AFTER_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  // Armed at creation: this check reads what the build SOUNDED, and the gesture
  // that opens the build's audio is delivered before the opening `reset` puts the
  // state back — so the harness handed over is the same one an unarmed check gets,
  // with its audio open. See audio/cue-connect for the whole argument.
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("sounds on the frame the segment is removed, and not in the gap before", async () => {
  const board = await loadBoard(h, R3_REDRAW);

  const played = watchCues(h);
  const retracted = await captureReplay(h, "retraction", async () => {
    // Draw one segment, emitter to lens, and hold the trace.
    const emitter = center(board, { col: 0, row: 0 });
    await mousePress(h, emitter.x, emitter.y);
    const lens = center(board, { col: 1, row: 0 });
    await mouseGlide(h, lens.x, lens.y);

    // The gap: the pointer rests on the live end, so nothing may sound.
    const afterAdd = played.length;
    await h.advance(GAP_TICKS);
    const afterGap = played.length;

    // Back onto the node behind the live end: the removal.
    await mouseGlide(h, emitter.x, emitter.y);
    // Read HERE, on the frame that consumed the move, with the trace still
    // held, so the beam read back is the removal's own outcome.
    const measured = {
      afterAdd,
      afterGap,
      frame: h.frame(),
      cues: [...played],
      beam: (await h.snapshot()).beams.triangle?.cells,
    };

    await mouseRelease(h);
    await h.advance(AFTER_TICKS);
    return measured;
  });

  // The segment was really removed: the beam is back to its starting cell.
  assertDeepEqual(
    retracted.beam,
    [{ col: 0, row: 0 }],
    "the last segment is removed and the live end backs up",
  );

  assertEqual(
    retracted.afterGap,
    retracted.afterAdd,
    "no sound in the gap between the add and the retraction",
  );
  const cues = retracted.cues.slice(retracted.afterGap);
  assertGreaterThan(cues.length, 0, "a sound on the removal frame");
  assertDeepEqual(
    cues.map((cue) => cue.frame),
    cues.map(() => retracted.frame),
    "every sound after the gap lands on the removal frame",
  );
});
