// Refract — audio/cue-clear: the clear cue plays exactly once on the frame the
// beams are cleared, when there was a segment to remove.
//
// Cues are the engine's to announce under this engine: the game plays the
// case-fixed names from the world's audio inside a tick and the engine
// announces every play as a `cue:played` event the harness recorded from
// before the game initialized.
//
// The clear is the real action: `clear` is bound to KeyR (specs/controls.md),
// pressed and released as a player would press it, and the one frame that
// delivers its edge is the frame the beams empty on — the frame the cue must
// play on, exactly once (specs/ui.md: each cue is played on the frame its
// event happens, at most once on that frame). A segment is on the board
// first, asserted before the press, because the cue's own condition is "when
// there was a segment to remove" — the empty-board half is
// audio/cue-clear-silent's point.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { CUES } from "../constants";
import { GEO_3X3 } from "../fixtures";
import {
  captureReplay,
  clearCues,
  createHarness,
  cuesNamed,
  loadBoard,
  resetTo,
  tapAction,
  type Harness,
} from "../harness";

/** Idle frames proving the silence before the clear, and shown in the replay. */
const LEAD_TICKS = 30; // 0.25 s

/** Frames recorded after the clear, showing the emptied board. */
const TAIL_TICKS = 60; // 0.5 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays the clear cue exactly once, on the frame the beams are cleared", async () => {
  await resetTo(h);
  await loadBoard(h, GEO_3X3);

  // The segment there is to remove. Its connect cue sounds here, and the log
  // is wiped after it so the section below reads the clear alone.
  h.debug.trace([
    { col: 0, row: 0 },
    { col: 1, row: 1 },
  ]);
  await h.advance(1);
  assertEqual(
    h.snapshot().beams.triangle?.cells.length,
    2,
    "a segment is on the board before the clear",
  );
  clearCues(h);

  const counts = await captureReplay(h, "clear", async () => {
    // The silence first: frames on which nothing is cleared play nothing.
    await h.advance(LEAD_TICKS);
    const before = cuesNamed(h, CUES.clear).length;

    // The clear action's own key, its edge delivered by the tap's one frame.
    await tapAction(h, "clear");
    const onFrame = cuesNamed(h, CUES.clear).length;

    await h.advance(TAIL_TICKS);
    return { before, onFrame };
  });

  assertDeepEqual(
    h.snapshot().beams.triangle?.cells,
    [],
    "the clear emptied the beam",
  );
  assertEqual(counts.before, 0, "no clear cue on any frame before the clear");
  assertEqual(counts.onFrame, 1, "exactly one clear cue by the clear's frame");
});
