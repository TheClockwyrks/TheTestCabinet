// Refract — audio/cue-clear: the clear cue plays exactly once on the frame the
// beams are cleared, when there was a segment to remove.
//
// The clear action is fired the way a player fires it: a real tap of the key
// BINDINGS binds to `clear` — specs/controls.md fixes it as KeyR — whose edge
// is delivered by the one frame the tap runs. That frame empties every beam
// (specs/controls.md "Clearing") and is therefore the frame the clear cue must
// play on, once (specs/ui.md). The segment it removes is drawn first through
// the surface's `trace`, so the precondition of the item — "when there was a
// segment to remove" — is posed and asserted before the key goes down.

import { afterEach, beforeEach, it } from "vitest";
import { CUES } from "../../src/constants";
import { assertDeepEqual, assertEqual } from "../assert";
import { GEO_3X3 } from "../fixtures";
import {
  captureReplay,
  createHarness,
  loadBoard,
  resetTo,
  tapAction,
  traceRoute,
  watchCues,
  type Harness,
} from "../harness";

/** Frames the recording idles before the clear, showing the drawn segment. */
const LEAD_FRAMES = 15;

/** Frames kept after the clear, so the reviewer sees the emptied board. */
const TAIL_FRAMES = 30;

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
  const played = watchCues(h);

  // One partial segment, drawn and released: something for clear to remove,
  // and nothing solved, so the clear lands on an ordinary mid-play board.
  traceRoute(h, [
    [0, 0],
    [1, 1],
  ]);
  await h.advance(1);
  assertEqual(
    h.snapshot().beams.triangle?.cells.length,
    2,
    "posing: there is a segment to remove (specs/ui.md: clear plays only " +
      "when there was one)",
  );

  const measured = await captureReplay(h, "clear", async () => {
    await h.advance(LEAD_FRAMES);
    // The real key: tapAction taps the first key bound to `clear` (KeyR,
    // specs/controls.md) and runs the one frame that delivers its edge.
    await tapAction(h, "clear");
    const result = {
      frame: h.engine.frame().count,
      beam: h.snapshot().beams.triangle?.cells.length,
      clears: played
        .filter((cue) => cue.cue === CUES.clear)
        .map((cue) => cue.frame),
    };
    await h.advance(TAIL_FRAMES);
    return result;
  });

  assertEqual(
    measured.beam,
    0,
    "posing: the clear action emptied the beam (specs/controls.md)",
  );
  assertDeepEqual(
    measured.clears,
    [measured.frame],
    "the clear cue plays exactly once, on the frame the beams are cleared " +
      "(specs/ui.md)",
  );
});
