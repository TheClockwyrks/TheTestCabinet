// Refract — audio/cue-clear: a cue sounds on the frame the beams are cleared,
// when there was a segment to remove.
//
// The cue's NAME is not observable outside an engineless build (see
// audio/cue-connect for the doctrine), so what is asserted is the timing: the
// `clear` action "empties every beam on the board at once" (specs/controls.md,
// through its fixed `KeyR` binding), its cue is "played on the frame its event
// happens, from `update`" (specs/ui.md), and the half second of resting board
// between the drawn segment and the key press must stay silent — the segment's
// own connect cue sounded earlier and is fenced off by that gap, so every sound
// after it belongs to the clear. The sibling point, audio/cue-clear-silent,
// holds the other half of the rule: no segment, no sound.
//
// The segment is drawn with the REAL mouse and the clear fired with the real
// key, one driven frame each, so both cues ride the build's own input layer.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { R3_REDRAW } from "../fixtures";
import {
  captureReplay,
  createHarness,
  fireAction,
  loadBoard,
  mouseTrace,
  watchCues,
  type Harness,
} from "../harness";

/** Half a second of resting board between the segment and the clear. */
const GAP_TICKS = 30;

/** Half a second recorded after the clear, so the replay shows the bare board. */
const AFTER_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  // Armed at creation: this check reads what the build SOUNDED, and the gesture
  // that opens the build's audio is delivered before the opening `reset` puts the
  // state back — so the board posed below is posed on a game nothing has touched.
  // See audio/cue-connect for the whole argument.
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("sounds on the frame the beams are cleared, and not in the gap before", async () => {
  const board = await loadBoard(h, R3_REDRAW);

  const played = watchCues(h);
  const cleared = await captureReplay(h, "clear", async () => {
    // One segment on the board, released, so the clear has something to remove.
    await mouseTrace(h, board, [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ]);

    const afterTrace = played.length;
    await h.advance(GAP_TICKS);
    const afterGap = played.length;

    await fireAction(h, "clear");
    // Read HERE, on the frame that delivered the key.
    const measured = {
      afterTrace,
      afterGap,
      frame: h.frame(),
      cues: [...played],
    };

    await h.advance(AFTER_TICKS);
    return measured;
  });

  // The clear really took: every beam is empty again.
  assertDeepEqual(
    (await h.snapshot()).beams.triangle?.cells,
    [],
    "the clear empties the beam",
  );

  assertEqual(
    cleared.afterGap,
    cleared.afterTrace,
    "no sound in the gap between the segment and the clear",
  );
  const cues = cleared.cues.slice(cleared.afterGap);
  assertGreaterThan(cues.length, 0, "a sound on the clear frame");
  assertDeepEqual(
    cues.map((cue) => cue.frame),
    cues.map(() => cleared.frame),
    "every sound after the gap lands on the clear frame",
  );
});
