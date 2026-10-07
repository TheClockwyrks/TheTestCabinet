// audio/fire-cue — the gun's cue.
//
// `specs/audio.md` fixes `fire` (`CUES.fire`) as the cue played when "The ship's
// gun takes a shot", and governs all six with one sentence: "Each is played on the
// tick its event happens and at most once on that tick."
//
// THE SHOT IS TAKEN, NOT POSED. `specs/instrumentation.md` is explicit that the
// surface carries no operation that fires — "A caller that wants a round places
// one; a caller checking firing itself drives the fire key and reads the bullets
// that appear" — and a round placed with `addBullet` is a pose rather than a shot,
// so it raises nothing. The fire key is therefore really held, and the tick the
// gun's own code puts a round in the roster is the tick the cue must sound on.
//
// THREE READINGS, AND WHY EACH IS HERE.
//
//   * NOTHING SOUNDS BEFORE THE SHOT. A quarter second is driven on the posed
//     field first, which is longer than the gun's own gate (`FIRE_INTERVAL_TICKS`,
//     22 ticks — `specs/weapons.md`), so a build that blips on its gate rather
//     than on the shot sounds inside the window and is caught.
//   * THE SHOT SOUNDS. Counted from the key press through the end of the tick the
//     round appeared, so a build that answers the key from its own DOM handler —
//     a moment no driven tick accounts for — is read the same as one that answers
//     it inside the tick. The ticks between the press and the round are asserted
//     silent, so that window is the event's own moment and nothing else.
//   * AND IT STOPS SOUNDING. The tail is one tick short of the gun's gate, so no
//     second shot could be taken inside it even if the key had stayed down — and
//     it is the part of "at most once on that tick" this engine can hear. A cue's
//     source COUNT is the build's (`./cues.ts`), so "once" is not a number a check
//     may assert; a build that keeps blipping after the shot is what the rule is
//     really against, and this is what names it.
//
// WHAT THIS CANNOT DECIDE. The cue's NAME, which is not observable from outside an
// engineless build (`./cues.ts`); whether the six are told apart by ear is the
// reviewer's. Nor the gun itself, which is `controls/fire-space`'s and
// `bullets/*`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { FIRE_INTERVAL_TICKS, KEY_FIRE, TICK_HZ } from "../constants";
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
  watchForEvent,
} from "./cues";

/**
 * The quiet window driven before the key goes down, in ticks.
 *
 * A quarter second, which is longer than `FIRE_INTERVAL_TICKS` (`22` ticks, under
 * a fifth of a second — `specs/weapons.md`): a build that sounds on the gun's own
 * gate rather than on a shot raises at least one blip inside it. The field is
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
 * build that reads its keyboard one tick behind the press, and small enough that
 * the window the cue is counted over stays the shot's own moment.
 */
const SHOT_TICKS = 4;

/**
 * The silence required after the shot, in ticks.
 *
 * One tick short of `FIRE_INTERVAL_TICKS` (`22`), so a second shot could not be
 * taken inside it even had the key stayed down — which makes every sound in this
 * window a sound `specs/audio.md` names no event for.
 */
const TAIL_TICKS = FIRE_INTERVAL_TICKS - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds on the tick the round appears, and not before or after it", async () => {
  await startPlaying(h);
  // A genuine, browser-trusted gesture first: `specs/audio.md` says an engineless
  // build's audio does not start until the player has interacted with the page, so
  // a key delivered any other way would leave a perfectly good build silent. The
  // key is bound to nothing (`specs/controls.md`), so arming changes no state.
  await armAudio(h);

  const shot = await watchForEvent(
    h,
    (s) => s.bullets.length > 0,
    QUIET_LEAD_TICKS + SHOT_TICKS,
    { quietLead: QUIET_LEAD_TICKS, arm: () => h.hold(KEY_FIRE) },
  );
  await h.release(KEY_FIRE);
  await captureStill(h, "shot");
  const tail = await driveQuiet(h, TAIL_TICKS);

  assertEqual(
    shot.hit,
    true,
    `the gun took a shot inside ${String(SHOT_TICKS)} ticks of ${KEY_FIRE} going ` +
      "down, from a ship whose fire gate was posed clear (specs/weapons.md)",
  );
  assertEqual(
    soundsBeforeEvent(shot),
    0,
    `sounds the build emitted over the ${String(shot.at - 1)} ticks before the ` +
      `round appeared — ${String(QUIET_LEAD_TICKS)} of them on an empty field ` +
      "with the key up, on which specs/audio.md names no event",
  );
  assertEqual(
    soundsBetween(shot, shot.armedAt, shot.at),
    0,
    "sounds the build emitted between the key going down and the tick its round " +
      "appeared, which is what makes the count below the shot's own moment",
  );
  assertGreaterThanOrEqual(
    shot.soundsSinceArm,
    1,
    "sounds the build emitted from the fire key going down through the tick its " +
      "round appeared — the gun taking a shot plays CUES.fire on that tick " +
      "(specs/audio.md)",
  );
  assertEqual(
    tail.sounds,
    0,
    `sounds the build emitted over the ${String(TAIL_TICKS)} ticks after the ` +
      `shot, one short of the gun's own ${String(FIRE_INTERVAL_TICKS)}-tick gate ` +
      `at ${String(TICK_HZ)} Hz, with the key released — a cue is played on the ` +
      "tick its event happens and nothing here raised one (specs/audio.md)",
  );
});
