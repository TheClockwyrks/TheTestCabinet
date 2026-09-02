// audio/thrust-cue-stops — releasing thrust stops the held sound.
//
// `specs/audio.md`: the thrust cue "starts on the tick thrust begins to be
// applied, sounds for as long as thrust is applied, and stops within a tenth of a
// second of thrust being released."
//
// THE OTHER END OF THE HELD CUE, READ THROUGH BOTH DOORS THE BUS OFFERS. A build
// holding the cue as a LOOP stops it with `audio.stop`, which the bus announces as
// `cue:stopped`; a build holding it by RE-PLAYING it stops it by ceasing to play.
// `specs/audio.md` demands neither convention, so what is read after the deadline
// is that the cue is no longer sounding EITHER way: no loop of it is running, and
// nothing plays it again.
//
// THE DEADLINE IS THE SPECIFICATION'S FIGURE AND NOT A TOLERANCE. A tenth of a
// second, which `specs/simulation.md`'s `TICK_HZ` (`120`) makes exactly twelve
// ticks. A build that takes longer has missed the bound the specification set, so
// the loop reading is taken AT the deadline rather than after the tail that
// follows it.
//
// TWO PRECONDITIONS, AND THEY ARE THE SIBLING POINT'S REQUIREMENT RATHER THAN THIS
// ONE'S. The cue has to have started, or there is nothing for a release to stop;
// and it has to still have been sounding when the key came up, or the silence this
// check reads would be a cue that had already finished on its own. Both are
// `audio/thrust-cue-starts`, and they are asserted here with that named, so a build
// with no thrust cue at all fails this point on the precondition rather than on the
// deadline it never reached.
//
// THE SHIP IS TURNED ACROSS THE FIELD FIRST, for the reason
// `audio/thrust-cue-starts` states: a burn along `FACE_UP` from the safe point runs
// into the star's core, and the slide of `specs/collision.md` has no business in a
// check about sound.

import { afterEach, beforeEach, it } from "vitest";
import { CUES, TICK_HZ } from "../constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  holdAction,
  keyFor,
  releaseAction,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import {
  countOf,
  loopsOpen,
  markOf,
  sinceMark,
  startsOnEvent,
  watchForEvent,
} from "./cues";

/** The facing the burn is taken along: `+x`, across the field and clear of the star. */
const ACROSS_THE_FIELD = 0;

/** The quiet window driven before the key goes down, in ticks. */
const QUIET_LEAD_TICKS = ticksFor(0.25);

/** The ticks the held key is given to begin the burn (`audio/thrust-cue-starts`). */
const BURN_TICKS = 4;

/**
 * How long the burn is held before the key comes up, in ticks.
 *
 * Half a second: long enough that a cue held across it is plainly being held
 * rather than caught mid-blip, and short enough that the ship stays well clear of
 * the star's core on a facing across the field.
 */
const HELD_TICKS = ticksFor(0.5);

/**
 * The window at the end of the hold a re-played cue must land in, in ticks.
 *
 * The specification's own resolution for this cue — a tenth of a second — used
 * here to establish the precondition that the sound was still running when the key
 * came up. Its derivation is `audio/thrust-cue-starts`'s.
 */
const SOUNDING_GRACE_TICKS = ticksFor(0.1);

/**
 * The deadline the release is measured against, in ticks.
 *
 * `specs/audio.md` fixes it as a tenth of a second and `specs/simulation.md` fixes
 * the timestep at `TICK_HZ` (`120`), so the deadline is exactly twelve ticks.
 */
const RELEASE_TICKS = ticksFor(0.1);

/** The one tick after the release the review item's picture is taken on. */
const PICTURE_TICKS = 1;

/**
 * The silence driven out past the deadline, in ticks.
 *
 * A quarter second, over which a build that held the cue by re-playing it must
 * play it no more: ceasing to play is how that convention stops, and a stop is
 * only visible in the plays that do not follow it.
 */
const TAIL_TICKS = ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("has CUES.thrust no longer sounding a tenth of a second after the key comes up", async () => {
  startPlaying(h);
  h.debug.setShipAngle(ACROSS_THE_FIELD);

  const burn = await watchForEvent(
    h,
    (s) => s.ship.thrusting,
    QUIET_LEAD_TICKS + BURN_TICKS,
    { quietLead: QUIET_LEAD_TICKS, arm: () => holdAction(h, "up") },
  );

  await h.advance(HELD_TICKS - SOUNDING_GRACE_TICKS);
  const closing = markOf(h);
  await h.advance(SOUNDING_GRACE_TICKS);
  const held = sinceMark(h, closing);
  const sounding =
    loopsOpen(h, CUES.thrust) + countOf(held.played, CUES.thrust);

  assertEqual(
    burn.hit,
    true,
    `the ship reported thrusting inside ${String(BURN_TICKS)} ticks of ` +
      `${keyFor("up")} going down — thrust is read as a hold ` +
      "(specs/controls.md)",
  );
  assertEqual(
    startsOnEvent(burn, CUES.thrust),
    1,
    "times CUES.thrust was played or started looping on the first tick the ship " +
      "reported thrusting, which is the sound a release has to stop — " +
      "audio/thrust-cue-starts is the point that requirement belongs to " +
      "(specs/audio.md)",
  );
  assertGreaterThan(
    sounding,
    0,
    "running loops of CUES.thrust plus plays of it inside the last " +
      `${String(SOUNDING_GRACE_TICKS)} ticks of the hold, which is what makes ` +
      "the silence below a release rather than a cue that had already finished " +
      "— again audio/thrust-cue-starts is the point that owns it " +
      "(specs/audio.md)",
  );

  // The release, and the deadline the specification sets on it.
  releaseAction(h, "up");
  await h.advance(PICTURE_TICKS);
  captureStill(h, "released");
  await h.advance(RELEASE_TICKS - PICTURE_TICKS);
  const stillLooping = loopsOpen(h, CUES.thrust);

  // Past the deadline: a build that held the cue by re-playing it stops by
  // ceasing to play, and only the ticks after the deadline can show that.
  const after = markOf(h);
  await h.advance(TAIL_TICKS);
  const tail = sinceMark(h, after);

  assertEqual(
    stillLooping,
    0,
    `loops of CUES.thrust still running ${String(RELEASE_TICKS)} ticks after ` +
      `the thrust key came up — a tenth of a second at ${String(TICK_HZ)} Hz, ` +
      "which is the deadline the held cue has to stop inside (specs/audio.md)",
  );
  assertEqual(
    countOf(tail.played, CUES.thrust),
    0,
    `times CUES.thrust played over the ${String(TAIL_TICKS)} ticks after that ` +
      "deadline, with thrust released throughout — a build holding the cue by " +
      "re-playing it stops it by playing it no more, and the cue stops within a " +
      "tenth of a second of thrust being released (specs/audio.md)",
  );
});
