// Refract — audio/cue-connect: the connect cue plays on the frame a segment is
// added, exactly once on that frame, and on no frame before it.
//
// Cues are the engine's to announce under this engine: the game defines the
// five names specs/ui.md fixes in its `initialize` and plays one from the
// world's audio inside a tick, and the engine announces every play as a
// `cue:played` event the harness recorded from before the game initialized.
// So a check reads what arrived — no audio device, no unlock gesture.
//
// THE EVENT IS RAISED THE WAY A PLAYER RAISES IT. specs/ui.md pins each cue to
// "the frame its event happens", played by the code that raised it, and that
// code runs in an update. The debug surface's pointer operations resolve at the
// CALL instead (specs/instrumentation.md), so a segment posed through them has
// no specified cue frame at all. The add here is therefore a real pointer
// sample — dispatched to the engine's own input system and read by the game's
// player controller inside the frame this check advances — so the frame under
// test is a frame the game genuinely resolved the move on. `audio/pointer.ts`
// is that path; the board is still arranged through `loadBoard`.
//
// The frame is then pinned by construction. The pointer is pressed on the
// emitter and left held, the cue log is wiped, and a stretch of idle frames
// with the pointer motionless proves no frame BEFORE the add plays connect.
// The one move that follows adds exactly one segment, and the one frame that
// delivers it is the frame the event happens on: exactly one connect has
// arrived by the end of it, carrying the case-fixed name, so a build that
// fired some other blip on the add is told apart from one that played
// `connect`.

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
import { playerMoveTo, playerPress, playerRelease } from "./pointer";

/** Idle frames proving the silence before the add, and shown in the replay. */
const LEAD_TICKS = 30; // 0.25 s

/** Frames the added segment is watched for after the add's own frame. */
const TAIL_TICKS = 60; // 0.5 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays the connect cue exactly once, on the frame the segment is added", async () => {
  await resetTo(h);
  await loadBoard(h, GEO_3X3);

  // The press that begins the trace at the emitter T(0,0). It adds no SEGMENT
  // — the beam is the one node it began at — and the log is wiped after it, so
  // the section below reads the one added segment alone.
  await playerPress(h, { col: 0, row: 0 });
  assertDeepEqual(
    h.snapshot().beams.triangle?.cells,
    [{ col: 0, row: 0 }],
    "the press begins the trace at the emitter, with no segment yet",
  );

  clearCues(h);
  const counts = await captureReplay(h, "hit", async () => {
    // The silence first: frames on which no segment is added play nothing.
    await h.advance(LEAD_TICKS);
    const before = cuesNamed(h, CUES.connect).length;

    // One segment — T(0,0) to t(1,1), one legal diagonal — moved to as a
    // player moves, and the one frame its event lands on.
    await playerMoveTo(h, { col: 1, row: 1 });
    const onFrame = cuesNamed(h, CUES.connect).length;

    // The tail keeps the drawn segment in the recording.
    await playerRelease(h, { col: 1, row: 1 });
    await h.advance(TAIL_TICKS);
    return { before, onFrame };
  });

  assertDeepEqual(
    h.snapshot().beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 1 },
    ],
    "the segment was added",
  );
  assertEqual(counts.before, 0, "no connect cue on any frame before the add");
  assertEqual(counts.onFrame, 1, "exactly one connect cue by the add's frame");
});
