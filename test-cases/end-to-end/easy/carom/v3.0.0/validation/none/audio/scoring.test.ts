// Carom — audio/scoring: a cue sounds on the frame a point is scored.
//
// A real ball is driven out of the right goal, down the mid-field lane that
// clears both obstacles, so the point is scored by the build's own scoring code
// rather than posed. The frame player one's score goes up is the frame the cue
// must sound on.
//
// WHAT IS OBSERVED. The sound itself, not the synthesis: `audio-init.js` watches a
// Web Audio source being started or an `<audio>` element being played, so a build
// that makes its blips any way at all is read the same. `specs/ui.md` requires one
// cue per event, on the frame of the event, which is what the two assertions below
// say. Nothing else may sound on the way — the drive crosses an empty lane — so a
// build that blips as the ball leaves the field is caught even though the cue's
// NAME is not observable from outside an engineless build.

import { afterEach, beforeEach, expect, it } from "vitest";
import {
  arrangeGoal,
  captureReplay,
  createHarness,
  startPlaying,
  watchCues,
  type Harness,
} from "../harness";

/**
 * Frames recorded after the point lands.
 *
 * The sweep stops on the frame the score changes, which is the frame the cue must
 * have sounded on and therefore where every reading has to be taken. A recording
 * that stopped there would cut on the goal itself: the review item promises "the
 * scored point whose cue is checked", and what tells a reviewer a point was
 * scored is the scoreboard turning over and the next countdown opening.
 */
const AFTERMATH_TICKS = 60; // 0.5 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds a cue on the frame the point lands, and not before it", async () => {
  await startPlaying(h, "versus");
  await h.armAudio();
  await arrangeGoal(h, "right");

  const played = watchCues(h);
  const point = await captureReplay(h, "score", async () => {
    const scored = await h.until((s) => s.score.p1 > 0, { maxFrames: 360 });
    // Read HERE, on the frame the sweep stopped: the frame number and the sounds
    // emitted by then are exactly what the assertions read before the aftermath
    // below was recorded.
    const measured = { scored, frame: h.frame(), cues: [...played] };
    await h.advance(AFTERMATH_TICKS);
    return measured;
  });

  expect(point.scored.hit).toBe(true);
  expect(point.scored.snapshot.score).toEqual({ p1: 1, p2: 0 });
  expect(point.cues.length).toBeGreaterThan(0);
  expect(point.cues.map((cue) => cue.frame)).toEqual(
    point.cues.map(() => point.frame),
  );
});
