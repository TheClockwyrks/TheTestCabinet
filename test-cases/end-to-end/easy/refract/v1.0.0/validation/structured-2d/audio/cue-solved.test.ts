// Refract — audio/cue-solved: the solved cue plays exactly once on the frame
// the board becomes solved, and on no frame before it.
//
// Cues are the engine's to announce under this engine: the game plays the
// case-fixed names from the world's audio inside a tick and the engine
// announces every play as a `cue:played` event the harness recorded from
// before the game initialized.
//
// THE EVENT IS RAISED THE WAY A PLAYER RAISES IT. specs/ui.md pins each cue to
// "the frame its event happens", played by the code that raised it, and that
// code runs in an update. The debug surface's pointer operations resolve at the
// CALL instead (specs/instrumentation.md), so a solve posed through them has no
// specified cue frame. Every pointer sample below is a real one, delivered to
// the engine's input system and read by the game's player controller inside
// the frame this check advances (`audio/pointer.ts`).
//
// The board is GEO_3X3, solved by the forced diagonal T(0,0)-t(1,1)-T(2,2) in
// two moves. The first draws one of the two segments — the board is not yet
// solved, and its frame plays no solved cue. The pointer then resumes at the
// live end (specs/controls.md) and the log is wiped, so a stretch of idle
// frames with the pointer motionless proves the "no frame before it" half. The
// move that follows is the one that makes R9 hold, and exactly one solved cue
// has arrived by the end of the frame that delivered it.

import { afterEach, beforeEach, it } from "vitest";
import { CUES } from "../../src/constants";
import { assertEqual } from "../assert";
import { GEO_3X3 } from "../fixtures";
import {
  captureReplay,
  clearCues,
  createHarness,
  cuesNamed,
  loadBoard,
  resetTo,
  type Harness,
} from "../harness";
import { playerDraw, playerMoveTo, playerPress } from "./pointer";

/** Idle frames proving the silence between the partial draw and the solve. */
const LEAD_TICKS = 30; // 0.25 s

/** Frames recorded after the solving move, showing where it leads. */
const TAIL_TICKS = 60; // 0.5 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays the solved cue exactly once, on the frame the board becomes solved", async () => {
  await resetTo(h);
  await loadBoard(h, GEO_3X3);

  // One segment of the two: drawn, released, and not a solve.
  await playerDraw(h, [
    { col: 0, row: 0 },
    { col: 1, row: 1 },
  ]);
  assertEqual(h.snapshot().solved, false, "one segment of two does not solve");

  // Resume at the live end t(1,1). Resuming solves nothing, and the log is
  // wiped after it so the section below reads the solving move alone.
  await playerPress(h, { col: 1, row: 1 });
  clearCues(h);

  const counts = await captureReplay(h, "solve", async () => {
    // The silence first: frames on which the board stays unsolved play nothing.
    await h.advance(LEAD_TICKS);
    const before = cuesNamed(h, CUES.solved).length;

    // The solving move: extend to the far emitter T(2,2).
    await playerMoveTo(h, { col: 2, row: 2 });
    const onFrame = cuesNamed(h, CUES.solved).length;

    await h.advance(TAIL_TICKS);
    return { before, onFrame };
  });

  assertEqual(h.snapshot().solved, true, "the move solved the board");
  assertEqual(counts.before, 0, "no solved cue on any frame before the solve");
  assertEqual(counts.onFrame, 1, "exactly one solved cue by the solve's frame");
});
