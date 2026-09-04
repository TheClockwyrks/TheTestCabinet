// audio/music-not-played-by-a-posed-screen — a posed `playing` screen sounds no
// music.
//
// specs/instrumentation.md, on `setScreen`: "Moving to `playing` this way runs
// the tick over the board as it stands rather than laying out a fresh round." And
// of every operation on the surface: "Each pose sets one thing and leaves the
// rest of the game as it stands... Nothing a caller does not ask for happens."
// specs/ui.md sounds `music` when "a round begins", and a posed screen is
// explicitly not a round beginning, so the bed stays silent.
//
// WHY THIS IS A SEPARATE POINT FROM `music-cue-plays`. That one decides that the
// bed DOES sound when a round begins. This decides the other direction: that
// nothing else sounds it. A build that reconciles the bed against the screen every
// frame — start it whenever the screen reads `playing`, stop it otherwise — passes
// that point and fails this one, and the two behaviours are told apart in the
// grade.
//
// WHY IT MATTERS THOUGH NOTHING IN PLAY LOOKS WRONG. The surface is a deliverable
// this project requires, and a surface that sounds a cue nothing asked for
// corrupts every scenario driven through it: a check watching for `eat` on the
// tick it resolves has to sift a bed out of its log first.
//
// THE POSED WORLD. The board is cleared of everything the point is not about and
// the snake's travel is held off, so no `eat`, no `combo-up` and no `death` can
// resolve either — what is read is a log that should be empty, not a log that
// should hold one thing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { CUES } from "../../src/constants";
import {
  captureReplay,
  createHarness,
  cuesNamed,
  poseScene,
  watchCues,
  type Harness,
} from "../harness";

/** Ticks the posed round is driven for, well past a frame of settling. */
const POSED_TICKS = 16;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sounds no music when the screen is posed onto playing", async () => {
  // Posed on the title, so the watch below opens before the screen ever reads
  // `playing` and the pose itself is inside what is watched.
  poseScene(h, { screen: "title", pellet: null, travel: false });

  const cues = watchCues(h);

  const posed = await captureReplay(h, "silent", async () => {
    h.debug.setScreen("playing");
    return h.tick(POSED_TICKS);
  });

  assertEqual(posed.screen, "playing", "the screen the pose left");
  assertLength(
    cuesNamed(cues, CUES.music),
    0,
    `music cues sounded over ${POSED_TICKS} ticks of a posed round`,
  );
});
