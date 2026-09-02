// audio/fire — the cue a shot plays.
//
// `specs/ui.md` fixes `CUES.fire` (`"fire"`) as the cue played when "the ship
// fires a shot", and governs all nine with one sentence: "Each is played on the
// frame its event happens and at most once on that frame."
//
// So the measurement is: pose an empty, quiet, live wave, hold the fire key, step
// one frame at a time, and read what the bus announced on the frame the shot left
// against what it announced on the frames before it. The frames before are the
// half a build cannot fake — a build that blips every frame sounds on the shot's
// frame too, and fails on the quiet that should have come first.
//
// THE SHOT IS FIRED, NOT POSED. `addPlayerBullet` would put a bullet on the field
// without the ship ever firing, and the cue is owed to the ship firing. So the key
// `specs/controls.md` binds the `a` action to is held on the engine's own input
// and the build's own cannon decides the rest.
//
// THE WORLD HOLDS THE SHIP ALONE. `startPosed` clears every drone, bullet and
// burst and shuts the three world gates, so nothing but the shot can happen inside
// this window; it also leaves the cooldown and the lockout clear, which is what
// lets the shot leave on the first frame the key is read.
//
// WHAT THIS DOES NOT DECIDE. That a shot leaves at all, or where from, which are
// `ship/*`'s and `controls/fire-space`'s.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, CUES, FIRE_INTERVAL } from "../constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  playerBullets,
  startPosed,
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

/** The first key `specs/controls.md` binds the `a` action to. */
const FIRE_KEY = BINDINGS.a[0];

/**
 * Frames of quiet driven before the key goes down.
 *
 * A fifth of a second on the very field the shot is then fired from, so "the fire
 * cue did not sound before the shot" is read across a real window rather than an
 * empty one. A build that blips every frame fails on these twenty frames.
 */
const QUIET_LEAD = ticksFor(0.2);

/**
 * Frames the held key is given to put a bullet on the field.
 *
 * `specs/ship.md` fires whenever the cooldown, the cap and the lockout allow, and
 * `startPosed` leaves all three clear, so a conforming build fires on the first
 * frame it reads the key down. A build that instead waits out a whole cadence tick
 * still fires inside `FIRE_INTERVAL` (`0.16`), and two frames of slack cover the
 * frame the key-down is delivered on.
 */
const FIRE_FRAMES = ticksFor(FIRE_INTERVAL) + 2;

/** Frames run after the reading, purely so the still shows the shot in flight. */
const TAIL_FRAMES = ticksFor(0.1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.fire on the frame the ship fires, and not before", async () => {
  // An empty, quiet, live wave: no drone, no bullet and no burst, and the three
  // world gates shut, so the only thing that can happen in this window is the shot
  // the check fires.
  startPosed(h);

  const watch = await watchForEvent(
    h,
    (s) => playerBullets(s).length > 0,
    QUIET_LEAD + FIRE_FRAMES,
    { quietLead: QUIET_LEAD, arm: () => h.hold(FIRE_KEY) },
  );
  h.release(FIRE_KEY);
  // Held on past the reading, so the still shows a bullet climbing rather than one
  // still inside the hull. Nothing after this line can reach an assertion.
  await h.advance(TAIL_FRAMES);
  captureStill(h, "shot");

  assertEqual(
    watch.hit,
    true,
    `a shot left the ship inside the ${String(FIRE_FRAMES)} frames after the ` +
      `${String(FIRE_KEY)} key went down, with the cooldown, the cap and the ` +
      "lockout all clear (specs/ship.md)",
  );
  assertEqual(
    cuesBeforeEvent(watch, CUES.fire),
    0,
    `times CUES.fire played over the ${String(quietFrames(watch))} frames ` +
      "before the shot, on an empty field where nothing else is happening — a " +
      "cue is played on the frame its event happens (specs/ui.md)",
  );
  assertEqual(
    cuesOnEvent(watch, CUES.fire),
    1,
    "times CUES.fire played on the frame the shot left the ship, which is its " +
      "own frame and at most once on it (specs/ui.md)",
  );
  assertGreaterThan(
    gainOnEvent(watch, CUES.fire),
    0,
    "the gain the bus announced the fire cue at, nothing here having muted it — " +
      "each of the nine is a distinct short sound a player hears (specs/ui.md)",
  );
});
