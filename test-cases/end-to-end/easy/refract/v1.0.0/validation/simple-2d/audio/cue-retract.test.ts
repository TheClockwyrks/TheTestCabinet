// Refract — audio/cue-retract: the retract cue plays on the frame a segment is
// removed, exactly once, and on no frame before it.
//
// A retraction is the live trace backing up: the pointer moving within
// NODE_HIT_R of the node immediately behind the live end removes the last
// segment (specs/controls.md "Retracting"). The whole gesture runs the way a
// player makes it — REAL pointer events on the stage, through the engine's own
// input, each sample read by the next frame's `update`. specs/ui.md fixes the
// cue to "the frame its event happens, from update", so the removal's frame is
// the frame that reads the move back, and the retract cue must be on it, once,
// with no retract before it. (The surface's pointer operations resolve
// immediately when called instead, specs/instrumentation.md — outside update,
// where the spec names no cue frame.)

import { afterEach, beforeEach, it } from "vitest";
import { CUES } from "../../src/constants";
import { assertDeepEqual, assertEqual } from "../assert";
import { GEO_3X3 } from "../fixtures";
import {
  captureReplay,
  createHarness,
  loadBoard,
  nodeCenter,
  resetTo,
  watchCues,
  type Harness,
} from "../harness";

/** Frames the recording idles before the removal, showing the drawn segment
 * and the silence the item requires. */
const LEAD_FRAMES = 15;

/** Frames kept after the removal, so the reviewer sees the unwound beam. */
const TAIL_FRAMES = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays the retract cue exactly once, on the frame the segment is removed", async () => {
  await resetTo(h);
  await loadBoard(h, GEO_3X3);
  const played = watchCues(h);

  // A held trace one segment long: a real press on the emitter T(0,0), then a
  // real move onto the lens t(1,1). The release is deliberately withheld —
  // retracting is a move of the LIVE trace.
  const emitter = nodeCenter(0, 0, 3, 3);
  const lens = nodeCenter(1, 1, 3, 3);
  h.pointer("pointerdown", emitter.x, emitter.y);
  await h.advance(1);
  h.pointer("pointermove", lens.x, lens.y);
  await h.advance(1);
  assertEqual(
    h.snapshot().beams.triangle?.cells.length,
    2,
    "posing: the held trace drew one segment (specs/controls.md)",
  );

  const measured = await captureReplay(h, "retraction", async () => {
    await h.advance(LEAD_FRAMES);
    // Back to the node immediately behind the live end: the segment just
    // drawn is removed and T(0,0) becomes the live end again.
    h.pointer("pointermove", emitter.x, emitter.y);
    await h.advance(1);
    const result = {
      frame: h.engine.frame().count,
      beam: h.snapshot().beams.triangle?.cells.length,
      retracts: played
        .filter((cue) => cue.cue === CUES.retract)
        .map((cue) => cue.frame),
    };
    h.pointer("pointerup", emitter.x, emitter.y);
    await h.advance(TAIL_FRAMES);
    return result;
  });

  assertEqual(
    measured.beam,
    1,
    "posing: the move back removed the last segment (specs/controls.md)",
  );
  assertDeepEqual(
    measured.retracts,
    [measured.frame],
    "the retract cue plays on the frame a segment is removed, exactly once " +
      "on that frame, and on no frame before it (specs/ui.md)",
  );
});
