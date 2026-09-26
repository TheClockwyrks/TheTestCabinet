// Refract — audio/cue-solved: the solved cue plays exactly once on the frame
// the board becomes solved, and on no frame before it.
//
// The board is MINIMAL_2X1 — one channel, its two emitters adjacent — so a
// single traced segment completes the only beam and satisfies R9 in the same
// move: the smallest solve there is, and the sharpest frame to pin the cue to.
// That frame also raises connect and channel-complete, each with its own
// review item; what is read here is the solved cue alone.
//
// The move is made the way a player makes it: REAL pointer events on the
// stage, through the engine's own input, each sample read by the next frame's
// `update`. specs/ui.md fixes each cue to "the frame its event happens, from
// update", so the solving frame is the frame that reads the move onto the
// second emitter. (The surface's pointer operations resolve immediately when
// called instead, specs/instrumentation.md — outside update, where the spec
// names no cue frame.)

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { CUES } from "../constants";
import { MINIMAL_2X1 } from "../fixtures";
import {
  captureReplay,
  createHarness,
  loadBoard,
  nodeCenter,
  resetTo,
  watchCues,
  type Harness,
} from "../harness";

/** Frames the recording idles before the solving move — the silence the item
 * requires ("on no frame before it") shown as well as read. */
const LEAD_FRAMES = 15;

/** Frames kept after the solve, so the reviewer sees where the game went. */
const TAIL_FRAMES = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays the solved cue exactly once, on the frame the board becomes solved", async () => {
  await resetTo(h);
  await loadBoard(h, MINIMAL_2X1);

  // Subscribed before any move, so a solved cue raised on any earlier frame
  // is caught too.
  const played = watchCues(h);

  // The 2x1 board's two emitters, side by side.
  const left = nodeCenter(0, 0, 2, 1);
  const right = nodeCenter(1, 0, 2, 1);

  const measured = await captureReplay(h, "solve", async () => {
    await h.advance(LEAD_FRAMES);

    // The press opens the trace on the left emitter and raises nothing.
    h.pointer("pointerdown", left.x, left.y);
    await h.advance(1);
    const opened = h.snapshot().tracing !== null;

    // The one segment between the two emitters: it completes the only
    // channel's beam and solves the board in the same move (specs/beams.md).
    h.pointer("pointermove", right.x, right.y);
    await h.advance(1);
    const result = {
      opened,
      frame: h.engine.frame().count,
      solved: h.snapshot().solved,
      solves: played
        .filter((cue) => cue.cue === CUES.solved)
        .map((cue) => cue.frame),
    };

    h.pointer("pointerup", right.x, right.y);
    await h.advance(TAIL_FRAMES);
    return result;
  });

  assertEqual(
    measured.opened,
    true,
    "posing: the real press opened a trace on the emitter (specs/controls.md)",
  );
  assertEqual(
    measured.solved,
    true,
    "posing: the traced segment solved the board (specs/beams.md R9)",
  );
  assertDeepEqual(
    measured.solves,
    [measured.frame],
    "the solved cue plays on the frame the board becomes solved, exactly " +
      "once on that frame, and on no frame before it (specs/ui.md)",
  );
});
