// audio/menu — the cue a menu move plays.
//
// `specs/ui.md` fixes `CUES.menu` (`"menu"`) as the cue played when "a menu
// highlight moves", and governs all nine with one sentence: "Each is played on the
// frame its event happens and at most once on that frame."
//
// So the measurement is: sit on the title screen with the highlight on the first
// item, hold the key `specs/controls.md` binds the `down` action to, step one
// frame at a time, and read what the bus announced on the frame the highlight
// moved against what it announced on the frames before it. The frames before are
// the half a build cannot fake — a build that blips every frame sounds on the
// move's frame too, and fails on the quiet that should have come first.
//
// THE MOVE IS PRESSED, NOT POSED. `setMenuIndex` would write the new highlight
// without the menu ever moving, and the cue is owed to the move. So `ArrowDown` is
// held on the engine's own input and the build's own menu decides the rest.
//
// THE TITLE IS WHERE IT IS READ, AND IT IS ALREADY AN ISOLATED WORLD.
// `specs/controls.md` has the `title` screen read `up`, `down`, `confirm` and
// `mute`, and `specs/ui.md` gives it a menu of the mode entry and `HOW TO PLAY`,
// so one `down` moves the highlight from the first item to the second. No wave has
// been built and no field is live behind it, so there is nothing to clear away.
//
// WHAT THIS DOES NOT DECIDE. Which item the highlight lands on, that it wraps, or
// what `confirm` takes, which are `controls/menu-*`'s and `screens/title-*`'s.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, CUES } from "../constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  ticksFor,
  type Harness,
} from "../harness";
import {
  cuesBeforeEvent,
  cuesOnEvent,
  gainOnEvent,
  quietFrames,
  watchForEvent,
} from "./cues";

/**
 * The key `specs/controls.md` binds the `down` action to, and to nothing else.
 *
 * `ArrowUp` and `KeyW` drive `up` AND `a`, and `Space` drives `confirm` AND `a`;
 * `ArrowDown` drives only `down`, so a press of it can be read one way alone.
 */
const DOWN_KEY = BINDINGS.down[0];

/** The item the title's highlight rests on when the game arrives there. */
const FIRST_ITEM = 0;

/**
 * Frames of quiet driven before the key goes down.
 *
 * A fifth of a second on the very screen the move is then made on, so "the menu
 * cue did not sound before the move" is read across a real window rather than an
 * empty one. A build that blips every frame fails on these twenty-four frames.
 */
const QUIET_LEAD = ticksFor(0.2);

/**
 * Frames the press is given to move the highlight.
 *
 * `specs/controls.md` reads `down` as a press edge, once per press, so a
 * conforming build moves the highlight on the frame the action is delivered. Two
 * more frames cover the frame the key-down itself is delivered on.
 */
const MOVE_FRAMES = 3;

/** Frames run after the reading, purely so the still shows the moved highlight. */
const TAIL_FRAMES = ticksFor(0.1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.menu on the frame a menu highlight moves, and not before", async () => {
  // The title, with the highlight where specs/ui.md rests it on arriving. A fresh
  // harness opens the game at its title, and these two lines state the scenario's
  // preconditions rather than leaning on that.
  h.debug.setScreen("title");
  h.debug.setMenuIndex(FIRST_ITEM);

  const watch = await watchForEvent(
    h,
    (s) => s.menuIndex !== FIRST_ITEM,
    QUIET_LEAD + MOVE_FRAMES,
    { quietLead: QUIET_LEAD, arm: () => h.hold(DOWN_KEY) },
  );
  h.release(DOWN_KEY);
  // Held on past the reading, so the still shows the highlight where the move put
  // it. Nothing after this line can reach an assertion.
  await h.advance(TAIL_FRAMES);
  captureStill(h, "menu");

  assertEqual(
    watch.hit,
    true,
    `the title's highlight left item ${String(FIRST_ITEM)} inside the ` +
      `${String(MOVE_FRAMES)} frames after the ${String(DOWN_KEY)} key went ` +
      "down, `down` being read once per press (specs/controls.md)",
  );
  assertEqual(
    cuesBeforeEvent(watch, CUES.menu),
    0,
    `times CUES.menu played over the ${String(quietFrames(watch))} frames ` +
      "before the move, on a title screen where nothing else is happening — a " +
      "cue is played on the frame its event happens (specs/ui.md)",
  );
  assertEqual(
    cuesOnEvent(watch, CUES.menu),
    1,
    "times CUES.menu played on the frame the highlight moved, which is its own " +
      "frame and at most once on it (specs/ui.md)",
  );
  assertGreaterThan(
    gainOnEvent(watch, CUES.menu),
    0,
    "the gain the bus announced the menu cue at, nothing here having muted it — " +
      "each of the nine is a distinct short sound a player hears (specs/ui.md)",
  );
});
