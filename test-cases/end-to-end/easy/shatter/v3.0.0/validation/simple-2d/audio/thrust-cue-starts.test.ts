// audio/thrust-cue-starts — the held cue begins with the burn, and is still
// sounding a second later.
//
// `specs/audio.md` gives `thrust` (`CUES.thrust`) alone among the six a duration:
// "it is held. It starts on the tick thrust begins to be applied, sounds for as
// long as thrust is applied, and stops within a tenth of a second of thrust being
// released. A single blip at the start of a burn is not this cue."
//
// EITHER DOOR OF THE BUS HOLDS A SOUND, AND NEITHER IS DEMANDED. The engine's bus
// carries a one-shot `play` and a `loop` that runs until it is stopped, and
// `specs/audio.md` fixes the cue as held without fixing which one holds it. A
// build that loops `CUES.thrust` across the burn and a build that re-plays it
// while the burn lasts both satisfy the sentence, so this point reads the two
// together: the cue STARTED on the burn's first tick — a `cue:played` or a
// `cue:looped` — and it is STILL SOUNDING a second later, which is a loop that
// nothing has stopped or a play inside the last tenth of a second. A single blip
// at the start of the burn satisfies neither, which is the build the
// specification's last sentence is about.
//
// THE TENTH OF A SECOND IS THE SPECIFICATION'S OWN FIGURE, not a tolerance chosen
// here: the same file allows the held cue a tenth of a second to stop in after a
// release, so a lapse shorter than that is one the specification itself does not
// call a stop. See {@link SOUNDING_GRACE_TICKS}.
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
import { CUES } from "../constants";
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
  startsBeforeEvent,
  startsOnEvent,
  watchForEvent,
} from "./cues";

/** The facing the burn is taken along: `+x`, across the field and clear of the star. */
const ACROSS_THE_FIELD = 0;

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
 * input one tick behind the press.
 */
const BURN_TICKS = 4;

/**
 * How long the burn is held past its first tick, in ticks.
 *
 * Exactly the second the point names: the cue has to be still sounding a second
 * after it started.
 */
const HELD_TICKS = ticksFor(1);

/**
 * The window at the end of that second a re-played cue must land in, in ticks.
 *
 * `specs/audio.md`'s own resolution for this cue: it allows the held sound a tenth
 * of a second to stop in once thrust is released, so a gap shorter than a tenth of
 * a second is one the specification does not itself call a stop. A build holding
 * the cue by re-playing it therefore has to have played it inside this window for
 * the sound to be running at the moment the second is up.
 */
const SOUNDING_GRACE_TICKS = ticksFor(0.1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("starts CUES.thrust on the burn's first tick and has it still sounding a second later", async () => {
  startPlaying(h);
  h.debug.setShipAngle(ACROSS_THE_FIELD);

  const burn = await watchForEvent(
    h,
    (s) => s.ship.thrusting,
    QUIET_LEAD_TICKS + BURN_TICKS,
    { quietLead: QUIET_LEAD_TICKS, arm: () => holdAction(h, "up") },
  );

  // The second the cue has to survive, with the key still down. Its last tenth is
  // marked off on its own, because that is the window a build holding the cue by
  // re-playing it has to have played inside.
  await h.advance(HELD_TICKS - SOUNDING_GRACE_TICKS);
  const mark = markOf(h);
  await h.advance(SOUNDING_GRACE_TICKS);
  const closing = sinceMark(h, mark);
  // The two ways the bus can say the cue is sounding at this moment, added: a loop
  // started and not stopped, and a play inside the closing tenth of a second.
  // Neither convention is demanded, so the reading is their sum.
  const sounding =
    loopsOpen(h, CUES.thrust) + countOf(closing.played, CUES.thrust);
  captureStill(h, "thrust");
  releaseAction(h, "up");

  assertEqual(
    burn.hit,
    true,
    `the ship reported thrusting inside ${String(BURN_TICKS)} ticks of ` +
      `${keyFor("up")} going down — thrust is read as a hold ` +
      "(specs/controls.md)",
  );
  assertEqual(
    startsBeforeEvent(burn, CUES.thrust),
    0,
    `times CUES.thrust was played or started looping over the ` +
      `${String(burn.at - 1)} ticks before the burn began, on an emptied field ` +
      "with a ship at rest — the cue starts on the tick thrust begins to be " +
      "applied (specs/audio.md)",
  );
  assertEqual(
    startsOnEvent(burn, CUES.thrust),
    1,
    "times CUES.thrust was played or started looping on the first tick the ship " +
      "reported thrusting — the thrust cue starts on the tick thrust begins to " +
      "be applied (specs/audio.md)",
  );
  assertGreaterThan(
    sounding,
    0,
    "running loops of CUES.thrust plus plays of it inside the closing " +
      `${String(SOUNDING_GRACE_TICKS)} ticks, a second after the burn began and ` +
      "with thrust still applied — the cue sounds for as long as thrust is " +
      "applied, and a single blip at the start of a burn is not this cue " +
      "(specs/audio.md)",
  );
});
