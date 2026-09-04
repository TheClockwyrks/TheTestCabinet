// Refract — audio/cue-channel-complete: the channel-complete cue plays exactly
// once on the frame a channel's beam becomes complete, alongside that same
// move's connect cue, each played once.
//
// specs/ui.md: a frame that raises more than one cue plays each of those once.
// The completing move both adds a segment (connect) and makes the beam
// complete (channel-complete), so both are read on that one frame. The board
// is R2_FOREIGN, whose triangle channel completes along the top row
// T(0,0)-t(1,0)-T(2,0) while the square channel stays untouched — so the board
// is NOT solved by the move and no solved cue can mix into the frame.
//
// The moves are made the way a player makes them: REAL pointer events on the
// stage, through the engine's own input, each sample read by the next frame's
// `update`. specs/ui.md fixes each cue to "the frame its event happens, from
// update", so the completing frame is the frame that reads the final move.
// (The surface's pointer operations resolve immediately when called instead,
// specs/instrumentation.md — outside update, where the spec names no cue
// frame.)

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { CUES } from "../constants";
import { R2_FOREIGN } from "../fixtures";
import {
  captureReplay,
  createHarness,
  loadBoard,
  nodeCenter,
  resetTo,
  watchCues,
  type Harness,
} from "../harness";

/** Frames the recording idles before the completing move, showing the partial
 * beam and the silence before the completion. */
const LEAD_FRAMES = 15;

/** Frames kept after the completion, so the reviewer sees the finished beam. */
const TAIL_FRAMES = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays channel-complete once on the completing frame, alongside that move's connect", async () => {
  await resetTo(h);
  await loadBoard(h, R2_FOREIGN);

  // Subscribed before any segment is drawn, so a channel-complete raised on
  // any earlier frame is caught too.
  const played = watchCues(h);

  // The triangle channel's three nodes, left to right along the top row.
  const first = nodeCenter(0, 0, 3, 3);
  const lens = nodeCenter(1, 0, 3, 3);
  const second = nodeCenter(2, 0, 3, 3);

  // The first triangle segment, drawn with a real press and move and held:
  // T(0,0) to the channel's only lens t(1,0). An ordinary add — the beam is
  // not yet complete.
  h.pointer("pointerdown", first.x, first.y);
  await h.advance(1);
  h.pointer("pointermove", lens.x, lens.y);
  await h.advance(1);
  assertEqual(
    h.snapshot().beams.triangle?.complete,
    false,
    "posing: one segment leaves the triangle beam incomplete (specs/beams.md)",
  );

  const measured = await captureReplay(h, "complete", async () => {
    await h.advance(LEAD_FRAMES);
    // The final segment, from the live end t(1,0) to the second emitter
    // T(2,0): the beam now runs emitter to emitter through every triangle
    // lens, so this one move makes it complete (specs/beams.md R6/R7) while
    // the square channel keeps the board unsolved.
    h.pointer("pointermove", second.x, second.y);
    await h.advance(1);
    const frame = h.engine.frame().count;
    const snapshot = h.snapshot();
    const result = {
      frame,
      complete: snapshot.beams.triangle?.complete,
      solved: snapshot.solved,
      completes: played
        .filter((cue) => cue.cue === CUES.channelComplete)
        .map((cue) => cue.frame),
      connectsOnFrame: played.filter(
        (cue) => cue.cue === CUES.connect && cue.frame === frame,
      ).length,
    };
    h.pointer("pointerup", second.x, second.y);
    await h.advance(TAIL_FRAMES);
    return result;
  });

  assertEqual(
    measured.complete,
    true,
    "posing: the move completed the channel's beam (specs/beams.md R6/R7)",
  );
  assertEqual(
    measured.solved,
    false,
    "posing: one complete channel leaves the board unsolved (specs/beams.md R9)",
  );
  assertDeepEqual(
    measured.completes,
    [measured.frame],
    "the channel-complete cue plays exactly once, on the frame the beam " +
      "becomes complete (specs/ui.md)",
  );
  assertEqual(
    measured.connectsOnFrame,
    1,
    "the same move's connect cue plays once alongside it (specs/ui.md: a " +
      "frame that raises more than one cue plays each of those once)",
  );
});
