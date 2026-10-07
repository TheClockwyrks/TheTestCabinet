// Wireworm — audio/game-over: losing the last life plays the `game-over` sting,
// on the frame the game-over screen opens.
//
// specs/ui.md's cue table: "`game-over` | `CUES.gameOver` | The `gameover`
// screen opens.", played "on the frame its event happens and at most once on
// that frame". specs/progression.md fixes when it opens: "A contact that takes
// lives to `0` ends the run instead: the game moves to the `gameover` screen".
// So the frame the sting owes itself to is the frame the snapshot reports
// `screen` as `gameover`.
//
// The run is posed on its LAST life, which is what separates this sting from the
// `life` cue audio/life reads: the same contact, driven from three lives, costs
// a life and plays that one instead. A build that plays the sting on every
// contact, and one that plays it on none, therefore each read differently from a
// build that sounds the end of the run when the run ends.
//
// The cursor's contact test is the one faculty this requirement exercises, so it
// is the one gate `startPlaying` shuts that this check turns back on, and the
// only one. The foe is posed with neither of its own faculties: a foe left
// travelling would drift out of the cursor's box, and one left thinking would eat
// the field underneath it.
//
// The `life` cue may sound on that same frame — a life was lost as the run
// ended — so this check counts the sting rather than demanding silence around it.

import { afterEach, beforeEach, it } from "vitest";
import { CUES } from "../constants";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
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
 * The lives the run is posed on: its last, so the contact below ends it rather
 * than spending one (specs/progression.md).
 */
const LAST_LIFE = 1;

/**
 * Frames the contact test is given to find the overlap.
 *
 * The foe is posed on the cursor's own center, so the two boxes overlap before a
 * frame has run and the test lands on the first update that runs it. A quarter
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

it("plays the game-over sting on the frame the game-over screen opens", async () => {
  startPlaying(h);
  h.debug.setLives(LAST_LIFE);
  // The one gate this requirement is about, and no other.
  h.debug.setCursorContact(true);
  // Centered on the cursor itself, so the overlap specs/cursor.md defines is
  // total and the reading cannot turn on where the box edges fall.
  const glitch = poseFoePoint(h, "glitch", BAND_CX, BAND_CY);
  h.debug.setFoeTravel(glitch, false);
  h.debug.setFoeMind(glitch, false);
  assertEqual(
    h.snapshot().lives,
    LAST_LIFE,
    "the run stands on its last life before the contact",
  );

  // Subscribed after the board is posed, so what is read is the contact alone.
  const played = watchCues(h);
  const ended = await h.until((s) => s.screen === "gameover", {
    maxFrames: CONTACT_TICKS,
  });
  // Read on the frame the sweep stopped, which is the frame the game-over screen
  // opened and therefore the frame the sting owes itself to.
  const frame = h.engine.frame().count;
  captureStill(h, "gameover");

  assertEqual(
    ended.hit,
    true,
    "a contact that takes lives to 0 ends the run (specs/progression.md)",
  );
  const stings = played.filter((cue) => cue.cue === CUES.gameOver);
  assertLength(stings, 1, "the game-over sting, once");
  assertEqual(
    stings[0].frame,
    frame,
    "the sting plays on the frame the game-over screen opens (specs/ui.md)",
  );
  assertGreaterThan(
    stings[0].gain,
    0,
    "the sting is audible with the bus unmuted",
  );
});
