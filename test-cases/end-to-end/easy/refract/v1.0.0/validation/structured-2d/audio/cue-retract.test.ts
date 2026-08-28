// Refract — audio/cue-retract: the retract cue plays on the frame a segment is
// removed, exactly once on that frame, and on no frame before it.
//
// Cues are the engine's to announce under this engine: the game plays the
// case-fixed names from the world's audio inside a tick and the engine
// announces every play as a `cue:played` event the harness recorded from
// before the game initialized.
//
// THE EVENT IS RAISED THE WAY A PLAYER RAISES IT. specs/ui.md pins each cue to
// "the frame its event happens", played by the code that raised it, and that
// code runs in an update. The debug surface's pointer operations resolve at the
// CALL instead (specs/instrumentation.md), so a removal posed through them has
// no specified cue frame. Every pointer sample below is therefore a real one,
// delivered to the engine's input system and read by the game's player
// controller inside the frame this check advances — `audio/pointer.ts` is that
// path — so the removal really does happen on the frame under test.
//
// The removal itself is the one specs/controls.md defines: a press on the
// beam's live end resumes the trace, and the pointer moving within NODE_HIT_R
// of the node immediately behind the live end removes the last segment, that
// node becoming the live end. A stretch of idle frames with the pointer
// motionless — after the segment's own connect has sounded and the log was
// wiped — proves no frame BEFORE the removal plays the cue.

import { afterEach, beforeEach, it } from "vitest";
import { CUES } from "../../src/constants";
import { assertDeepEqual, assertEqual } from "../assert";
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
import {
  playerDraw,
  playerMoveTo,
  playerPress,
  playerRelease,
} from "./pointer";

/** Idle frames proving the silence before the removal. */
const LEAD_TICKS = 30; // 0.25 s

/** Frames recorded after the removal, showing the shortened beam. */
const TAIL_TICKS = 60; // 0.5 s

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

  // The segment to remove: T(0,0) to t(1,1), drawn and released as a player
  // draws it. Its own connect cue sounds here.
  await playerDraw(h, [
    { col: 0, row: 0 },
    { col: 1, row: 1 },
  ]);
  assertEqual(
    h.snapshot().beams.triangle?.cells.length,
    2,
    "the segment is on the board before the retraction",
  );

  // Resume at the live end t(1,1). Resuming removes nothing, and the log is
  // wiped after it so the section below reads the retraction alone.
  await playerPress(h, { col: 1, row: 1 });
  clearCues(h);

  const counts = await captureReplay(h, "retraction", async () => {
    // The silence first: frames on which no segment is removed play nothing.
    await h.advance(LEAD_TICKS);
    const before = cuesNamed(h, CUES.retract).length;

    // Back the pointer to T(0,0) — the node immediately behind the live end —
    // and the one frame that delivers the move is the frame it comes off on.
    await playerMoveTo(h, { col: 0, row: 0 });
    const onFrame = cuesNamed(h, CUES.retract).length;
    const live = h.snapshot().tracing?.live;

    await playerRelease(h, { col: 0, row: 0 });
    await h.advance(TAIL_TICKS);
    return { before, live, onFrame };
  });

  assertDeepEqual(
    counts.live,
    { col: 0, row: 0 },
    "the retracted-to node became the live end",
  );
  assertEqual(
    counts.before,
    0,
    "no retract cue on any frame before the removal",
  );
  assertEqual(
    counts.onFrame,
    1,
    "exactly one retract cue by the removal's frame",
  );
});
