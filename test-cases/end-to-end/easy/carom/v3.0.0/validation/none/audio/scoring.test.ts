// Carom — audio/scoring: a cue sounds on the frame a point is scored.
//
// A scored point is about a ball and a goal edge, so the field is emptied and one
// ball is spawned back onto it: both obstacles are REMOVED rather than shot
// around, and the paddles — which cannot be removed, being furniture the game
// always has — are stood out of the lane with neither taken from the player,
// because this requirement needs no driven paddle. A real ball is then driven out
// of the right goal down that empty field, so the point is scored by the build's
// own scoring code rather than posed, and the frame player one's score goes up is
// the frame the cue must sound on.
//
// WHAT IS OBSERVED. The sound itself, not the synthesis: `audio-init.js` watches a
// Web Audio source being started or an `<audio>` element being played, so a build
// that makes its blips any way at all is read the same. `specs/ui.md` requires one
// cue per event, on the frame of the event, which is what the two assertions below
// say. Nothing else may sound on the way — the drive crosses an empty field — so a
// build that blips as the ball leaves the field is caught even though the cue's
// NAME is not observable from outside an engineless build.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
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
  // Armed at creation: a build may open its audio context from a real DOM event
  // alone, so the harness presses a genuine key — and it presses it before its
  // own opening `reset`, whose restore erases whatever the press moved. What
  // survives into this check is only the page's user activation, which is the
  // half a build cannot make a sound without.
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("sounds a cue on the frame the point lands, and not before it", async () => {
  await startPlaying(h, "versus");
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

  assertEqual(point.scored.hit, true);
  assertDeepEqual(point.scored.snapshot.score, { p1: 1, p2: 0 });
  assertGreaterThan(point.cues.length, 0);
  assertDeepEqual(
    point.cues.map((cue) => cue.frame),
    point.cues.map(() => point.frame),
  );
});
