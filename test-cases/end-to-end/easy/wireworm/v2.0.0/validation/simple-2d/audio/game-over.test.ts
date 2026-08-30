// audio/game-over — losing the last life plays the game-over sting.
//
// specs/ui.md fixes `CUES.gameOver` (`"game-over"`) as the cue played when "the
// `gameover` screen opens", and governs all ten with one sentence: "Each is played
// on the frame its event happens and at most once on that frame."
//
// So the measurement is: stand one foe on the cursor with one life left, step one
// frame at a time, and read what sounded on the frame the game-over screen opened
// against what sounded over the frames before it.
//
// THE RUN IS POSED ON ITS LAST LIFE. specs/progression.md branches on exactly
// that: "a contact that takes lives to `0` ends the run instead", moving the game
// to `gameover`. Posed with lives to spare the same contact would cost a life and
// open a respawn, which is `audio/life`'s point, so `setLives(1)` is what makes
// this scenario the ending one and the two points read different events.
//
// THE CURSOR'S CONTACT GATE IS TURNED BACK ON, AND THIS IS A POINT ENTITLED TO.
// `startPlaying` shuts it so no scenario is derailed by an incidental life loss,
// and the one requirement that gate IS belongs to the life-loss points
// (specs/instrumentation.md). The invulnerability is left at zero, which is what
// `startPlaying` poses.
//
// THE FOE IS STOOD ON THE CURSOR RATHER THAN DRIVEN INTO IT. specs/cursor.md makes
// contact an overlap of boxes, so a foe added at the cursor's own reported center
// overlaps it outright, and both of its faculties are then off so it neither
// travels out of the overlap nor acts on the board.
//
// WHAT THIS DOES NOT DECIDE. That a contact at zero lives ends the run, and the
// level the ended run reports, are `progression.game-over-at-zero-lives`'s and
// `progression.game-over-records-level`'s requirements. This point reads the cue
// alone.

import { afterEach, beforeEach, it } from "vitest";
import { CUES } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  lastFoe,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { cuesBeforeEvent, cuesOnEvent, watchForEvent } from "./cues";

/** The lives the run is posed on, so the next contact takes it to zero. */
const LAST_LIFE = 1;

/**
 * Frames the overlap is given to end the run.
 *
 * specs/cursor.md tests contact as an overlap of the cursor's box and the foe's,
 * and the foe is added already overlapping, so a conforming build reads it on the
 * first frame after the pose and specs/progression.md moves to `gameover` on that
 * same contact. A fifth of a second is a hard ceiling more than twenty times that,
 * so a build that resolves contact late still reaches a verdict rather than
 * running the suite out.
 */
const CONTACT_FRAMES = ticksFor(0.2);

/**
 * Frames of silence driven on the posed board before the foe is stood on the
 * cursor.
 *
 * As long as the window the contact is looked for in, so the quiet the check reads
 * across is the same size as the window the event is found in.
 */
const QUIET_LEAD = CONTACT_FRAMES;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.gameOver on the frame the gameover screen opens, and not before", async () => {
  startPlaying(h);
  h.debug.setCursorContact(true);
  h.debug.setLives(LAST_LIFE);

  const posed = h.snapshot();
  assertEqual(
    posed.lives,
    LAST_LIFE,
    "posing: the run stands on its last life, so the contact ends it rather " +
      "than costing a life (specs/progression.md)",
  );
  assertEqual(
    posed.screen,
    "playing",
    "posing: the run is being played, so the game-over screen is one the " +
      "contact opens (specs/ui.md)",
  );

  const watch = await watchForEvent(
    h,
    (s) => s.screen === "gameover",
    QUIET_LEAD + CONTACT_FRAMES,
    {
      quietLead: QUIET_LEAD,
      arm: () => {
        const { cursor } = h.snapshot();
        h.debug.addFoe("glitch", cursor.x, cursor.y);
        const foe = lastFoe(h.snapshot()).id;
        h.debug.setFoeTravel(foe, false);
        h.debug.setFoeMind(foe, false);
      },
    },
  );
  captureStill(h, "gameover");

  assertEqual(
    watch.hit,
    true,
    `the contact ended the run inside the ${String(CONTACT_FRAMES)} frames ` +
      "the check allows it, with a foe standing on the cursor's own center " +
      "and one life left (specs/cursor.md, specs/progression.md)",
  );
  assertEqual(
    cuesBeforeEvent(watch, CUES.gameOver),
    0,
    `times CUES.gameOver played over the ${String(watch.at - 1)} frames ` +
      "before the game-over screen opened (specs/ui.md: a cue is played on " +
      "the frame its event happens)",
  );
  assertEqual(
    cuesOnEvent(watch, CUES.gameOver),
    1,
    "times CUES.gameOver played on the frame the game-over screen opened, " +
      "which is its own frame and at most once on it (specs/ui.md)",
  );
});
