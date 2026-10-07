// audio/menu — the cue a menu move plays.
//
// `specs/ui.md` fixes `menu` as the cue played when "a menu highlight moves", and
// governs all nine with one sentence: "Each is played on the frame its event
// happens and at most once on that frame."
//
// So the measurement is: sit on the title screen with the highlight on the first
// item, press the key `specs/controls.md` binds the `down` action to, step one
// frame at a time, and read what sounded on the frame the highlight moved against
// what sounded on the frames before it. The frames before are the half a build
// cannot fake — a build that blips every frame sounds on the move's frame too,
// and fails on the quiet that should have come first.
//
// THE MOVE IS PRESSED, NOT POSED. `setMenuIndex` would write the new highlight
// without the menu ever moving, and the cue is owed to the move. So `ArrowDown`
// is held through Chromium's own input pipeline and the build's own menu decides
// the rest. `ArrowDown` is the right key to press here because
// `specs/controls.md` binds it to `down` and to nothing else, so the press cannot
// be read as any other action.
//
// THE TITLE IS WHERE IT IS READ. `specs/controls.md` has the `title` screen read
// `up`, `down`, `confirm` and `mute`, and `specs/ui.md` gives it a menu of the
// mode entry and `HOW TO PLAY`, so one `down` moves the highlight from the first
// item to the second. Nothing else is running behind it: the game opens there and
// no wave has been built.
//
// WHAT THIS ENGINE CANNOT SEE. The cue's NAME, and how many sources one cue is
// made of. `./cues.ts` states why, and what these checks assert instead.
//
// WHAT THIS DOES NOT DECIDE. Which item the highlight lands on, that it wraps, or
// what `confirm` takes, which are `controls/menu-*`'s and `screens/title-*`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { BINDINGS } from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  type Harness,
} from "../harness";
import {
  quietFrames,
  soundsBeforeEvent,
  soundsOnEvent,
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
 * A fifth of a second on the very screen the move is then made on, so "nothing
 * sounded before the move" is read across a real window rather than an empty one.
 * A build that blips every frame fails on these twenty frames.
 */
const QUIET_LEAD = framesFor(0.2);

/**
 * Frames the press is given to move the highlight.
 *
 * `specs/controls.md` reads `down` as a press edge, "once per press", so a
 * conforming build moves the highlight on the frame the action is delivered. Two
 * more frames cover the frame the key-down itself is delivered on.
 */
const MOVE_FRAMES = 3;

/** Frames run after the reading, purely so the still shows the moved highlight. */
const TAIL_FRAMES = framesFor(0.1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds on the frame a menu highlight moves, and not before", async () => {
  // A real, browser-trusted gesture first: an engineless build owns its whole
  // audio layer and is entitled to open it on the player's first interaction
  // alone (`specs/ui.md`). The key is bound to nothing, so this changes no state.
  await h.armAudio();
  // The title, with the highlight where `specs/ui.md` rests it on arriving. The
  // harness has already reset the game to its title, and this states the two
  // things the scenario needs rather than leaning on that.
  await h.debug.setScreen("title");
  await h.debug.setMenuIndex(FIRST_ITEM);

  const watch = await watchForEvent(
    h,
    (s) => s.menuIndex !== FIRST_ITEM,
    QUIET_LEAD + MOVE_FRAMES,
    { quietLead: QUIET_LEAD, arm: () => h.hold(DOWN_KEY) },
  );
  await h.release(DOWN_KEY);
  // Held on past the reading, so the still shows the highlight where the move put
  // it. Nothing after this line can reach an assertion.
  await h.advance(TAIL_FRAMES);
  await captureStill(h, "menu");

  assertEqual(
    watch.hit,
    true,
    `the title's highlight left item ${String(FIRST_ITEM)} inside the ` +
      `${String(MOVE_FRAMES)} frames after the ${String(DOWN_KEY)} key went ` +
      "down, `down` being read once per press (specs/controls.md)",
  );
  assertEqual(
    soundsBeforeEvent(watch),
    0,
    `sounds the build emitted over the ${String(quietFrames(watch))} frames ` +
      "before the move, on a title screen where nothing else is happening — a " +
      "cue is played on the frame its event happens (specs/ui.md)",
  );
  assertGreaterThanOrEqual(
    soundsOnEvent(watch),
    1,
    "sounds the build emitted on the frame the highlight moved, which is the " +
      "frame the menu cue is played on (specs/ui.md)",
  );
});
