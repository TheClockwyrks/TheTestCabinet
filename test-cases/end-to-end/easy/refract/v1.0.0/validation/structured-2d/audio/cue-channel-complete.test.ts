// Refract — audio/cue-channel-complete: the channel-complete cue plays exactly
// once on the frame a channel's beam becomes complete, alongside that same
// move's connect cue, each played once.
//
// Cues are the engine's to announce under this engine: the game plays the
// case-fixed names from the world's audio inside a tick and the engine
// announces every play as a `cue:played` event the harness recorded from
// before the game initialized.
//
// THE EVENT IS RAISED THE WAY A PLAYER RAISES IT. specs/ui.md pins each cue to
// "the frame its event happens", played by the code that raised it, and that
// code runs in an update. The debug surface's pointer operations resolve at the
// CALL instead (specs/instrumentation.md), so a completion posed through them
// has no specified cue frame. Every pointer sample below is a real one,
// delivered to the engine's input system and read by the game's player
// controller inside the frame this check advances (`audio/pointer.ts`).
//
// The board is R2_FOREIGN — two channels, so completing the triangle beam does
// NOT solve the board and the completion stands alone. The beam is built in
// two moves: the first adds a segment short of completion (its frame must play
// connect and no channel-complete — that is the "no frame before it" half),
// the pointer then resumes at the live end (specs/controls.md) and the log is
// wiped, and the second move extends to the far emitter, making R6 and R7
// hold. On that move's frame both cues arrive, each exactly once (specs/ui.md:
// a frame that raises more than one of them plays each of those once).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CUES } from "../constants";
import { R2_FOREIGN } from "../fixtures";
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

/** Frames recorded after the completing move, showing the finished beam. */
const TAIL_TICKS = 60; // 0.5 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays channel-complete and connect once each, on the completing frame", async () => {
  await resetTo(h);
  await loadBoard(h, R2_FOREIGN);

  // The incomplete prefix: T(0,0) to the lens t(1,0), drawn and released as a
  // player draws it. Connect sounds for the added segment; channel-complete
  // must not — no frame before the completion plays it.
  await playerDraw(h, [
    { col: 0, row: 0 },
    { col: 1, row: 0 },
  ]);
  assertEqual(
    h.snapshot().beams.triangle?.complete,
    false,
    "the prefix leaves the beam incomplete",
  );
  assertEqual(
    cuesNamed(h, CUES.channelComplete).length,
    0,
    "no channel-complete cue before the beam completes",
  );

  // Resume at the live end t(1,0). Resuming completes nothing, and the log is
  // wiped after it so the section below reads the completing move alone.
  await playerPress(h, { col: 1, row: 0 });
  clearCues(h);

  const counts = await captureReplay(h, "complete", async () => {
    // The completing move: extend to the far emitter T(2,0) — now the beam
    // joins both emitters and threads the channel's one lens (R6, R7).
    await playerMoveTo(h, { col: 2, row: 0 });
    const measured = {
      complete: cuesNamed(h, CUES.channelComplete).length,
      connect: cuesNamed(h, CUES.connect).length,
    };
    await h.advance(TAIL_TICKS);
    return measured;
  });

  assertEqual(
    h.snapshot().beams.triangle?.complete,
    true,
    "the move completed the triangle beam",
  );
  assertEqual(
    h.snapshot().solved,
    false,
    "the square channel keeps the board open",
  );
  assertEqual(
    counts.complete,
    1,
    "exactly one channel-complete cue on that frame",
  );
  assertEqual(counts.connect, 1, "the same move's connect cue, played once");
});
