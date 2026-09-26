// audio/life — a contact that costs a life plays the life cue.
//
// specs/ui.md fixes `CUES.life` (`"life"`) as the cue played when "a life is
// lost", and governs all ten with one sentence: "Each is played on the frame its
// event happens and at most once on that frame."
//
// So the measurement is: stand one foe on the cursor, step one frame at a time,
// and read what sounded on the frame the lives fell against what sounded over the
// frames before it.
//
// THE CURSOR'S CONTACT GATE IS TURNED BACK ON, AND THIS IS THE POINT ENTITLED TO.
// `startPlaying` shuts it so no scenario is derailed by an incidental life loss,
// and the one requirement that gate IS belongs to the life-loss points
// (specs/instrumentation.md). Its invulnerability is left at zero, which is what
// `startPlaying` poses, so specs/cursor.md's "while the spawn-in invulnerability
// is still running, a contact costs no life" cannot be what is being read here.
//
// THE FOE IS STOOD ON THE CURSOR RATHER THAN DRIVEN INTO IT. specs/cursor.md makes
// contact an overlap of boxes, `FOE_HALF` against `CURSOR_HALF`, so a foe added at
// the cursor's own reported center overlaps it outright. Driving one in would make
// the check depend on the foe's speed as well, which is a figure this point does
// not decide. Both of the foe's faculties are then off, so it neither travels out
// of the overlap nor acts on the board.
//
// THE RUN HAS LIVES TO SPARE. `START_LIVES` is `3` and none has been spent, so
// specs/progression.md takes the "with lives to spare" branch: lives fall by one
// and the phase becomes `respawn`. Losing the LAST life opens the game-over screen
// instead, and that is `audio/game-over`'s point.
//
// WHAT THIS DOES NOT DECIDE. That a contact costs a life at all is
// `cursor.foe-contact-costs-life`'s requirement, and what the respawn does is the
// `progression.respawn-*` points'. This point reads the cue alone.

import { afterEach, beforeEach, it } from "vitest";
import { CUES, START_LIVES } from "../constants";
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

/**
 * Frames the overlap is given to cost a life.
 *
 * specs/cursor.md tests contact as an overlap of the cursor's box and the foe's,
 * and the foe is added already overlapping, so a conforming build reads it on the
 * first frame after the pose. A fifth of a second is a hard ceiling more than
 * twenty times that, so a build that resolves contact late still reaches a verdict
 * rather than running the suite out.
 */
const CONTACT_FRAMES = ticksFor(0.2);

/**
 * Frames of silence driven on the posed board before the foe is stood on the
 * cursor.
 *
 * As long as the window the contact is looked for in, so the quiet the check reads
 * across is the same size as the window the event is found in, and a build
 * sounding the cue at any rate at all is as likely to be caught before the contact
 * as on it.
 */
const QUIET_LEAD = CONTACT_FRAMES;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.life on the frame a contact costs a life, and not before", async () => {
  startPlaying(h);
  h.debug.setCursorContact(true);

  const posed = h.snapshot();
  assertEqual(
    posed.lives,
    START_LIVES,
    "posing: the run still holds every one of its starting lives, so the " +
      "contact costs one rather than ending the run (specs/progression.md)",
  );
  assertEqual(
    posed.cursor.invulnerable,
    0,
    "posing: the cursor carries no spawn-in invulnerability, which would cost " +
      "the contact its life (specs/cursor.md)",
  );

  const watch = await watchForEvent(
    h,
    (s) => s.lives < START_LIVES,
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
  captureStill(h, "contact");

  assertEqual(
    watch.hit,
    true,
    `the contact cost a life inside the ${String(CONTACT_FRAMES)} frames the ` +
      "check allows it, with a foe standing on the cursor's own center " +
      "(specs/cursor.md)",
  );
  assertEqual(
    cuesBeforeEvent(watch, CUES.life),
    0,
    `times CUES.life played over the ${String(watch.at - 1)} frames before ` +
      "the lives fell (specs/ui.md: a cue is played on the frame its event " +
      "happens)",
  );
  assertEqual(
    cuesOnEvent(watch, CUES.life),
    1,
    "times CUES.life played on the frame the lives fell, which is its own " +
      "frame and at most once on it (specs/ui.md)",
  );
});
