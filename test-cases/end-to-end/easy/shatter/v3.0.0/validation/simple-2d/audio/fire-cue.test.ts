// audio/fire-cue — the gun's cue.
//
// `specs/audio.md` fixes `fire` (`CUES.fire`) as the cue played when "The ship's
// gun takes a shot", and governs all six with one sentence: "Each is played on the
// tick its event happens and at most once on that tick."
//
// THE SHOT IS TAKEN, NOT POSED. `specs/instrumentation.md` carries no operation
// that fires, and a round placed with `addBullet` is a pose rather than a shot, so
// it raises nothing. The fire key is really held, and the tick the gun's own code
// puts a round in the roster is the tick the cue must sound on.
//
// THREE READINGS, AND WHY EACH IS HERE.
//
//   * NOTHING SOUNDS BEFORE THE SHOT. A quarter second is driven on the posed
//     field first, which is longer than the gun's own gate (`FIRE_INTERVAL_TICKS`,
//     22 ticks — `specs/weapons.md`), so a build that blips on its gate rather
//     than on the shot sounds inside the window and is caught.
//   * THE SHOT SOUNDS `CUES.fire`, EXACTLY ONCE. The bus announces a play by name,
//     so "at most once on that tick" is a number this engine's checks can assert
//     outright rather than approach.
//   * AND THE SHOT IS THE ONLY ONE. The key is released and a tail one tick short
//     of the gun's gate is driven out: no second shot could be taken inside it even
//     had the key stayed down, so a `fire` cue landing there is one
//     `specs/audio.md` names no event for.
//
// THE SHIP IS TURNED ACROSS THE FIELD FIRST. `startPlaying` leaves it at the safe
// point facing `FACE_UP`, which points it at the star: the round would fly into the
// core and be absorbed (`specs/collision.md`), bringing a system this point is not
// about into the window it reads. Facing `+x`, the round crosses empty field.
//
// WHAT THIS DOES NOT DECIDE. The gun itself, which is `controls/fire-space`'s and
// `bullets/*`'s; and whether the six cues are told apart by ear, which is the
// reviewer's.

import { afterEach, beforeEach, it } from "vitest";
import { CUES, FIRE_INTERVAL_TICKS, TICK_HZ } from "../../src/constants";
import { assertEqual } from "../assert";
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
  markOf,
  playedBeforeEvent,
  playedOnEvent,
  sinceMark,
  watchForEvent,
} from "./cues";

/** The facing the shot is taken along: `+x`, across the field and clear of the star. */
const ACROSS_THE_FIELD = 0;

/**
 * The quiet window driven before the key goes down, in ticks.
 *
 * A quarter second, which is longer than `FIRE_INTERVAL_TICKS` (`22` ticks, under
 * a fifth of a second — `specs/weapons.md`): a build that sounds on the gun's own
 * gate rather than on a shot raises at least one `fire` inside it. The field is
 * empty and the ship is at rest through the whole of it, so `specs/audio.md` names
 * no event that could sound here.
 */
const QUIET_LEAD_TICKS = ticksFor(0.25);

/**
 * The ticks the held key is given to produce its round.
 *
 * `specs/weapons.md`: "One press of the fire key takes one shot when the gate
 * allows it", and `startPlaying` leaves `fireCooldown` at `0`, so a conformant
 * build shoots on the first tick that reads the key down. Four is the margin for a
 * build that reads its input one tick behind the press, and small enough that the
 * window the cue is counted over stays the shot's own moment.
 */
const SHOT_TICKS = 4;

/**
 * The silence required after the shot, in ticks.
 *
 * One tick short of `FIRE_INTERVAL_TICKS` (`22`), so a second shot could not be
 * taken inside it even had the key stayed down — which makes a `fire` cue in this
 * window one `specs/audio.md` names no event for.
 */
const TAIL_TICKS = FIRE_INTERVAL_TICKS - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.fire on the tick the round appears, exactly once, and not before or after", async () => {
  startPlaying(h);
  h.debug.setShipAngle(ACROSS_THE_FIELD);

  const shot = await watchForEvent(
    h,
    (s) => s.bullets.length > 0,
    QUIET_LEAD_TICKS + SHOT_TICKS,
    { quietLead: QUIET_LEAD_TICKS, arm: () => holdAction(h, "a") },
  );
  captureStill(h, "shot");
  releaseAction(h, "a");

  const mark = markOf(h);
  await h.advance(TAIL_TICKS);
  const tail = sinceMark(h, mark);

  assertEqual(
    shot.hit,
    true,
    `the gun took a shot inside ${String(SHOT_TICKS)} ticks of ` +
      `${keyFor("a")} going down, from a ship whose fire gate was posed clear ` +
      "(specs/weapons.md)",
  );
  assertEqual(
    playedBeforeEvent(shot, CUES.fire),
    0,
    `times CUES.fire played over the ${String(shot.at - 1)} ticks before the ` +
      `round appeared — ${String(QUIET_LEAD_TICKS)} of them on an empty field ` +
      "with the key up, on which specs/audio.md names no event",
  );
  assertEqual(
    playedOnEvent(shot, CUES.fire),
    1,
    "times CUES.fire played on the tick the gun's round appeared — a cue is " +
      "played on the tick its event happens and at most once on that tick " +
      "(specs/audio.md)",
  );
  assertEqual(
    countOf(tail.played, CUES.fire),
    0,
    `times CUES.fire played over the ${String(TAIL_TICKS)} ticks after the ` +
      `shot, one short of the gun's own ${String(FIRE_INTERVAL_TICKS)}-tick gate ` +
      `at ${String(TICK_HZ)} Hz, with the key released — no second shot could be ` +
      "taken inside it, so specs/audio.md names no event for one",
  );
});
