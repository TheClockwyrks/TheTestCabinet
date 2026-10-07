// Wireworm — audio/life: a contact that costs a life plays the `life` cue, on
// the frame lives falls.
//
// specs/ui.md's cue table: "`life` | `CUES.life` | A life is lost.", played "on
// the frame its event happens and at most once on that frame". specs/cursor.md
// fixes the event — "A worm segment or a foe reaching the cursor costs one
// life", contact being an overlap of the two boxes — and specs/progression.md
// fixes what it costs: "Lives falls by one." So the frame the cue owes itself to
// is the frame the snapshot reports one life fewer.
//
// The cursor's contact test is the one faculty this requirement exercises, so it
// is the one gate `startPlaying` shuts that this check turns back on, and the
// only one. The foe is posed with neither of its own faculties: the requirement
// is the CONTACT, and a foe left travelling would drift out of the cursor's box
// while a foe left thinking would eat the field underneath it.
//
// Lives are posed with more than one to spare, so the contact costs a life
// rather than ending the run — specs/progression.md sends a contact that takes
// lives to `0` to the `gameover` screen instead, and that sting is
// audio/game-over's requirement. A build that plays the wrong one of the two is
// therefore named for the one it got wrong.

import { afterEach, beforeEach, it } from "vitest";
import { CUES, START_LIVES } from "../constants";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  BAND_CX,
  BAND_CY,
  captureStill,
  createHarness,
  poseFoePoint,
  startPlaying,
  ticksFor,
  watchCues,
  type Harness,
} from "../harness";

/**
 * Frames the contact test is given to find the overlap.
 *
 * The foe is posed on the cursor's own center, so the two boxes overlap before
 * a frame has run and the test lands on the first update that runs it. A quarter
 * of a second is thirty frames of slack around that.
 */
const CONTACT_TICKS = ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays the life cue on the frame lives falls", async () => {
  startPlaying(h);
  h.debug.setLives(START_LIVES);
  // The one gate this requirement is about, and no other.
  h.debug.setCursorContact(true);
  // Centered on the cursor itself, so the overlap specs/cursor.md defines is
  // total and the reading cannot turn on where the box edges fall.
  const glitch = poseFoePoint(h, "glitch", BAND_CX, BAND_CY);
  h.debug.setFoeTravel(glitch, false);
  h.debug.setFoeMind(glitch, false);
  assertEqual(
    h.snapshot().lives,
    START_LIVES,
    "the run stands at its full lives before the contact",
  );

  // Subscribed after the board is posed, so what is read is the contact alone.
  const played = watchCues(h);
  const touched = await h.until((s) => s.lives < START_LIVES, {
    maxFrames: CONTACT_TICKS,
  });
  // Read on the frame the sweep stopped, which is the frame lives fell and
  // therefore the frame the cue owes itself to. The still is that frame: the
  // lives readout one short, and the board the respawn swept.
  const frame = h.engine.frame().count;
  captureStill(h, "contact");

  assertEqual(
    touched.hit,
    true,
    "a foe reaching the cursor costs a life (specs/cursor.md)",
  );
  assertDeepEqual(
    played.map((cue) => cue.cue),
    [CUES.life],
    "the life cue, once, and nothing else on an otherwise silent board",
  );
  assertEqual(
    played[0].frame,
    frame,
    "the cue plays on the frame lives falls (specs/ui.md)",
  );
  assertGreaterThan(
    played[0].gain,
    0,
    "the cue is audible with the bus unmuted",
  );
});
