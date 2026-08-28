// Refract — audio/cue-connect: the connect cue plays on the frame a segment is
// added, exactly once, and on no frame before it.
//
// Cues are the engine's under this build. The game defines the five CUES names
// and asks for one from `update` on the frame its event happens (specs/ui.md);
// the engine announces every play as a `cue:played` event, synchronously, so a
// check subscribes and reads what arrived — no audio device, no unlock
// gesture.
//
// The segment is added the way a player adds one: REAL pointer events on the
// stage, through the engine's own input, where a sample is read by the next
// frame's `update`. That matters for the cue specifically — specs/ui.md fixes
// each cue to "the frame its event happens, from update", and only the real
// pointer path resolves the add inside an update, so only it has a cue frame
// to name. (The surface's pointer operations take effect immediately when
// called instead, specs/instrumentation.md, so a segment posed that way is
// resolved outside update and has no specified cue frame.) The press on the
// emitter opens the trace and raises nothing; the move onto the adjacent lens
// is the add, and the cue must be on the frame that reads it, once, with
// silence before.

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

/** Frames the recording idles before the add — the silence the item requires
 * ("on no frame before it") shown on the clip as well as read by the check. */
const LEAD_FRAMES = 15;

/** Frames kept after the add, so the reviewer sees the drawn segment rest. */
const TAIL_FRAMES = 30;

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

  // Subscribed before anything can add a segment, so "no frame before it" is
  // read over the whole run and not just the recorded stretch.
  const played = watchCues(h);

  // GEO_3X3: the triangle emitter T(0,0) and the lens t(1,1) one legal R1
  // diagonal away. That one segment neither completes the beam (the second
  // emitter T(2,2) is still unreached) nor solves the board, so the only
  // event the move raises is the segment add.
  const emitter = nodeCenter(0, 0, 3, 3);
  const lens = nodeCenter(1, 1, 3, 3);

  const measured = await captureReplay(h, "hit", async () => {
    await h.advance(LEAD_FRAMES);

    // The press: a real pointerdown on the emitter, read by the next frame's
    // update. It opens the trace and adds nothing.
    h.pointer("pointerdown", emitter.x, emitter.y);
    await h.advance(1);
    const opened = h.snapshot().tracing !== null;

    // The add: a real pointermove onto the adjacent lens.
    h.pointer("pointermove", lens.x, lens.y);
    await h.advance(1);
    const result = {
      opened,
      frame: h.engine.frame().count,
      beam: h.snapshot().beams.triangle?.cells.length,
      connects: played
        .filter((cue) => cue.cue === CUES.connect)
        .map((cue) => cue.frame),
    };

    h.pointer("pointerup", lens.x, lens.y);
    await h.advance(TAIL_FRAMES);
    return result;
  });

  assertEqual(
    measured.opened,
    true,
    "posing: the real press opened a trace on the emitter (specs/controls.md)",
  );
  assertEqual(
    measured.beam,
    2,
    "posing: the real move added the segment (specs/controls.md)",
  );
  assertDeepEqual(
    measured.connects,
    [measured.frame],
    "the connect cue plays on the frame a segment is added, exactly once on " +
      "that frame, and on no frame before it (specs/ui.md)",
  );
});
