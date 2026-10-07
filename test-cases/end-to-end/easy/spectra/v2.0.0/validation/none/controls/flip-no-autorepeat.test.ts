// Spectra — controls/flip-no-autorepeat: a held flip key flips the band exactly
// once.
//
// THE RULE. `specs/controls.md` divides the actions in two: `left`, `right` and
// `a` are read as HOLDS, and "`up`, `down`, `b`, `discharge`, `confirm`, `back`,
// `pause`, and `mute` are read as press edges, once per press: holding one of them
// acts exactly once." `b` is the flip. This point decides that sentence for `b`:
// the key held down for a whole second must move the ship's band once and leave it
// there, not oscillate with the browser's key auto-repeat and not flip on every
// frame the key is found down.
//
// WHY THE BAND IS SAMPLED EVERY FRAME RATHER THAN READ AT THE END. The band has
// exactly two values (`specs/bands.md`), so reading it once at the end of the hold
// cannot tell one flip from three, or from ninety-nine: every odd number of flips
// ends on magenta. What is counted instead is every frame-to-frame CHANGE of
// `ship.band` across the hold, which distinguishes each wrong model by a different
// number — a build that ignores the key counts 0, a build that flips once counts 1,
// a build that repeats on the browser's auto-repeat counts a handful, and a build
// that flips on every frame the key is down counts near `HOLD_FRAMES`. The frame
// is 10 ms here, far finer than any auto-repeat interval, so nothing can hide
// between two samples.
//
// THE KEY IS A REAL ONE, AND IT IS REALLY HELD. `hold` and `release` press through
// Chromium's own input pipeline, so the browser delivers its own auto-repeat
// `keydown` events for the held key exactly as it would for a player leaning on
// it — which is the trap this point exists to catch, and a trap a synthetic press
// posed at an event target would never spring.
//
// WHAT IS NOT ASSERTED. Which keys are bound to `b` at all is decided by
// `controls/flip-f`, `controls/flip-shift-left` and `controls/flip-shift-right`;
// the lockout a flip starts is `bands`' and `ship`'s. This point asserts the count
// and the resting band, and nothing else.
//
// THE WORLD IS EMPTY. `startPosed` clears the four rosters and shuts the wave's
// three gates, so nothing but the key can touch the band over the held second.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  startPosed,
  type Harness,
} from "../harness";

/** The key held. `controls/flip-f` decides that it is bound to `b` at all. */
const FLIP_KEY = "KeyF";

/** How long it is held: the second the point's own wording names. */
const HOLD_SECONDS = 1.0;
const HOLD_FRAMES = framesFor(HOLD_SECONDS);

/** The band a run — and `startPosed` — puts the ship on (`specs/bands.md`). */
const START_BAND = "cyan";
/** Where one flip, and only one, leaves it. */
const OPPOSITE_BAND = "magenta";

/** "Holding one of them acts exactly once" (`specs/controls.md`), as a number. */
const FLIPS_ALLOWED = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("flips the band once over a second of held flip, and not again", async () => {
  await startPosed(h);
  const before = await h.snapshot();
  assertEqual(before.screen, "inWave", "the wave the key is held in is live");
  assertEqual(before.ship.band, START_BAND, "the ship starts on cyan");

  let flips = 0;
  let band = before.ship.band;
  await h.hold(FLIP_KEY);
  try {
    for (let frame = 0; frame < HOLD_FRAMES; frame += 1) {
      await h.advance(1);
      const now = (await h.snapshot()).ship.band;
      if (now !== band) flips += 1;
      band = now;
    }
  } finally {
    await h.release(FLIP_KEY);
  }
  await captureStill(h, "once");

  assertEqual(
    flips,
    FLIPS_ALLOWED,
    `a ${HOLD_SECONDS}s hold changed the ship's band exactly once`,
  );
  assertEqual(
    band,
    OPPOSITE_BAND,
    "and left it on the opposite band when the key came up",
  );
});
