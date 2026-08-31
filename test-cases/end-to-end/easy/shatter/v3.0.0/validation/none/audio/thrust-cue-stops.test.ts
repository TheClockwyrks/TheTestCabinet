// audio/thrust-cue-stops — releasing thrust stops the held sound.
//
// `specs/audio.md`: the thrust cue "starts on the tick thrust begins to be
// applied, sounds for as long as thrust is applied, and stops within a tenth of a
// second of thrust being released."
//
// THE OTHER END OF THE HELD CUE, READ THROUGH THE OTHER DOOR. A release makes no
// sound, so there is nothing for `watchCues` to hear; what is observable is the
// voice being told to stop, which `../audio-init.js` counts on every
// `AudioScheduledSourceNode.stop()` and every `<audio>` element being paused. So
// the burn is really held, the key is really released, and the tenth of a second
// the specification allows is driven out one tick at a time.
//
// THE STOP IS COUNTED FROM THE BUILD'S RUNNING TOTAL, not from a tick's
// attribution. A key comes up between two driven ticks, and a build that answers
// the release from its own DOM handler stops its voice at a moment no tick
// accounts for. `specs/audio.md` fixes a DEADLINE here rather than a tick — "within
// a tenth of a second" — so both are inside the window it allows, and the reading
// is the total across it.
//
// TWO PRECONDITIONS, AND THEY ARE THE SIBLING POINT'S REQUIREMENT RATHER THAN THIS
// ONE'S. A voice has to have started, or there is nothing for a release to stop;
// and it has to still be sounding when the key comes up, or the stop this check
// reads would be a one-shot blip's own scheduled end rather than the release's.
// Both are `audio/thrust-cue-starts`, and they are asserted here with that named,
// so a build with no thrust cue at all fails this point on the precondition rather
// than on the deadline it never reached.
//
// THE SHIP IS TURNED ACROSS THE FIELD FIRST, for the reason
// `audio/thrust-cue-starts` states: a burn along `FACE_UP` from the safe point runs
// into the star's core, and the slide of `specs/collision.md` has no business in a
// check about sound.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { KEYS_THRUST } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { driveQuiet, stopsFromEvent, watchForEvent } from "./cues";

/** The facing the burn is taken along: `+x`, across the field and clear of the star. */
const ACROSS_THE_FIELD = 0;

/** The key `specs/controls.md` binds thrust to first. */
const THRUST_KEY = KEYS_THRUST[0];

/** The quiet window driven before the key goes down, in ticks. */
const QUIET_LEAD_TICKS = ticksFor(0.25);

/** The ticks the held key is given to begin the burn (`audio/thrust-cue-starts`). */
const BURN_TICKS = 4;

/**
 * How long the burn is held before the key comes up, in ticks.
 *
 * Half a second: long enough that a voice held across it is plainly being held
 * rather than caught mid-blip, and short enough that the ship stays well clear of
 * the star's core on a facing across the field.
 */
const HELD_TICKS = ticksFor(0.5);

/**
 * The deadline the release is measured against, in ticks.
 *
 * `specs/audio.md` fixes it as a tenth of a second, and `specs/simulation.md` fixes
 * the timestep at `TICK_HZ` (`120`), so the deadline is exactly twelve ticks. It is
 * the specification's figure and not a tolerance: a build that takes longer has
 * missed the bound the specification set.
 */
const RELEASE_TICKS = ticksFor(0.1);

/** The one tick after the release the review item's picture is taken on. */
const PICTURE_TICKS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stops a sounding voice within a tenth of a second of the key coming up", async () => {
  await startPlaying(h);
  // A genuine, browser-trusted gesture: an engineless build's audio does not start
  // until the player has interacted with the page (`specs/audio.md`), and the key
  // is bound to nothing (`specs/controls.md`).
  await h.armAudio();
  await h.debug.setShipAngle(ACROSS_THE_FIELD);

  const burn = await watchForEvent(
    h,
    (s) => s.ship.thrusting,
    QUIET_LEAD_TICKS + BURN_TICKS,
    { quietLead: QUIET_LEAD_TICKS, arm: () => h.hold(THRUST_KEY) },
  );
  const held = await driveQuiet(h, HELD_TICKS);

  assertEqual(
    burn.hit,
    true,
    `the ship reported thrusting inside ${String(BURN_TICKS)} ticks of ` +
      `${THRUST_KEY} going down — thrust is read as a hold (specs/controls.md)`,
  );
  assertGreaterThanOrEqual(
    burn.soundsSinceArm,
    1,
    "sounds the build emitted as the burn began, which is the voice a release " +
      "has to stop — audio/thrust-cue-starts is the point that requirement " +
      "belongs to (specs/audio.md)",
  );
  assertEqual(
    stopsFromEvent(burn) + held.stops,
    0,
    `sounding voices the build stopped over the ${String(HELD_TICKS)} ticks of ` +
      "held thrust before the key came up — a voice already stopped while thrust " +
      "was still being applied is a blip rather than the held cue, and again " +
      "audio/thrust-cue-starts is the point that owns it (specs/audio.md)",
  );

  const before = await h.stops();
  await h.release(THRUST_KEY);
  await h.advance(PICTURE_TICKS);
  await captureStill(h, "released");
  await h.advance(RELEASE_TICKS - PICTURE_TICKS);
  const stopped = (await h.stops()) - before;

  assertGreaterThanOrEqual(
    stopped,
    1,
    `sounding voices the build stopped over the ${String(RELEASE_TICKS)} ticks ` +
      "after the thrust key came up — the held cue stops within a tenth of a " +
      "second of thrust being released (specs/audio.md)",
  );
});
