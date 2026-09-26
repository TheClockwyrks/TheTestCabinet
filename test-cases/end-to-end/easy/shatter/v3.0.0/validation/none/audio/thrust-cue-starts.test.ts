// audio/thrust-cue-starts — the held cue begins with the burn, and is still
// sounding a second later.
//
// `specs/audio.md` gives `thrust` (`CUES.thrust`) alone among the six a duration:
// "it is held. It starts on the tick thrust begins to be applied, sounds for as
// long as thrust is applied, and stops within a tenth of a second of thrust being
// released. A single blip at the start of a burn is not this cue."
//
// HOW A HELD SOUND IS HEARD FROM OUTSIDE AN ENGINELESS BUILD. `../audio-init.js`
// counts both doors a browser can emit sound through and both directions through
// them: a source being started, and a sounding voice being stopped. A cue that is
// HELD is one voice started when the burn begins and told to stop when it ends, so
// the reading is a start on the burn's first tick and NO STOP over the second that
// follows. A single blip is the shape that separates from: a one-shot cue schedules
// its own end at the moment it plays — `start()` and `stop(when)` are both called
// on the event's tick — so a build that blips once as the burn opens registers a
// stop inside the window and fails here, which is exactly the build the
// specification's last sentence is about.
//
// THAT IS THE READING, AND ITS EDGE IS STATED HONESTLY. What is measured is that
// nothing the build started was told to stop while thrust was still being applied.
// A build that synthesized the rumble as a stream of re-triggered grains, stopping
// each as the next began, would fail it — the specification calls the cue held, and
// this is the closest an outside listener can come to that word. The cue's NAME is
// not observable here at all (`./cues.ts`).
//
// THE SHIP IS TURNED ACROSS THE FIELD FIRST. `startPlaying` leaves it at the safe
// point facing `FACE_UP`, which points it at the star: a burn along that facing
// would reach the core and bring the slide of `specs/collision.md` into a check
// about sound. Facing `+x` from the safe point, the burn never comes within 200
// units of the star's centre, so the only system running is the one this point is
// about.
//
// WHAT THIS DOES NOT DECIDE. The release, which is `audio/thrust-cue-stops`'s; the
// acceleration, which is `flight/thrust-accelerates`'s; and the flame, which is
// `presentation/thrust-flame-while-thrusting`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { KEYS_THRUST } from "../constants";
import {
  armAudio,
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import {
  driveQuiet,
  soundsBeforeEvent,
  soundsBetween,
  stopsFromEvent,
  watchForEvent,
} from "./cues";

/** The facing the burn is taken along: `+x`, across the field and clear of the star. */
const ACROSS_THE_FIELD = 0;

/** The key `specs/controls.md` binds thrust to first. */
const THRUST_KEY = KEYS_THRUST[0];

/**
 * The quiet window driven before the key goes down, in ticks.
 *
 * A quarter second on an emptied field with a ship at rest, which
 * `specs/audio.md` names no event for, so a build that sounds inside it is
 * sounding when nothing happened.
 */
const QUIET_LEAD_TICKS = ticksFor(0.25);

/**
 * The ticks the held key is given to begin the burn.
 *
 * `specs/controls.md` reads thrust as a hold — "the ship turns and accelerates for
 * as long as the key is down" — so a conformant build is thrusting on the first
 * tick that reads the key down. Four is the margin for a build that reads its
 * keyboard one tick behind the press.
 */
const BURN_TICKS = 4;

/**
 * How long the burn is held past its first tick, in ticks.
 *
 * Exactly the second the item names: the cue has to be still sounding a second
 * after it started.
 */
const HELD_TICKS = ticksFor(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("starts a sound on the burn's first tick and has not stopped it a second later", async () => {
  await startPlaying(h);
  // A genuine, browser-trusted gesture: an engineless build's audio does not start
  // until the player has interacted with the page (`specs/audio.md`), and the key
  // is bound to nothing (`specs/controls.md`).
  await armAudio(h);
  await h.debug.setShipAngle(ACROSS_THE_FIELD);

  const burn = await watchForEvent(
    h,
    (s) => s.ship.thrusting,
    QUIET_LEAD_TICKS + BURN_TICKS,
    { quietLead: QUIET_LEAD_TICKS, arm: () => h.hold(THRUST_KEY) },
  );
  // Still held: the second the cue has to survive.
  const held = await driveQuiet(h, HELD_TICKS);
  await captureStill(h, "thrust");
  await h.release(THRUST_KEY);

  assertEqual(
    burn.hit,
    true,
    `the ship reported thrusting inside ${String(BURN_TICKS)} ticks of ` +
      `${THRUST_KEY} going down — thrust is read as a hold (specs/controls.md)`,
  );
  assertEqual(
    soundsBeforeEvent(burn),
    0,
    `sounds the build emitted over the ${String(burn.at - 1)} ticks before the ` +
      "burn began, on an emptied field with a ship at rest",
  );
  assertEqual(
    soundsBetween(burn, burn.armedAt, burn.at),
    0,
    "sounds the build emitted between the thrust key going down and the first " +
      "tick the ship reported thrusting, which is what makes the count below the " +
      "burn's own moment",
  );
  assertGreaterThanOrEqual(
    burn.soundsSinceArm,
    1,
    "sounds the build emitted from the thrust key going down through the first " +
      "tick the ship was thrusting — the thrust cue starts on the tick thrust " +
      "begins to be applied (specs/audio.md)",
  );
  assertEqual(
    stopsFromEvent(burn) + held.stops,
    0,
    "sounding voices the build stopped over the second of held thrust after the " +
      "burn began — the thrust cue sounds for as long as thrust is applied and " +
      "stops on its release, and a single blip at the start of a burn is not " +
      "this cue (specs/audio.md)",
  );
});
