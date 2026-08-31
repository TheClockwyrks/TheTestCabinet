// Spectra — controls/flip-no-autorepeat: a held flip key flips the band exactly
// once.
//
// THE RULE. `specs/controls.md` divides the actions in two: `left`, `right` and `a`
// are read as HOLDS, and "`up`, `down`, `b`, `discharge`, `confirm`, `back`, `pause`,
// and `mute` are read as press edges, once per press: holding one of them acts
// exactly once." `b` is the flip. This point decides that sentence for `b`: the key
// held down for a whole second must move the ship's band once and leave it there,
// rather than flipping again on every frame the key is found down.
//
// WHAT THE HOLD ACTUALLY SEPARATES UNDER THIS ENGINE. The engine offers the two
// readings as two calls: `value`, non-zero for every frame the key is down, and
// `pressed`, true once per armed edge and consumed by the call that sees it (the
// engine's own `engine/input.md`). A build that read the flip through `value` — the
// wrong half of `specs/controls.md`'s division — flips on every one of the hundred
// and twenty frames below and fails here while passing `controls/flip-f`. That is
// the whole distinction this point is for, and it is exactly the fault the
// specification's sentence forbids.
//
// WHY THE BAND IS SAMPLED EVERY FRAME RATHER THAN READ AT THE END. The band has
// exactly two values (`specs/bands.md`), so reading it once at the end of the hold
// cannot tell one flip from three, or from ninety-nine: every odd number of flips
// ends on magenta. What is counted instead is every frame-to-frame CHANGE of
// `ship.band` across the hold, which distinguishes each wrong model by a different
// number — a build that ignores the key counts 0, a build that flips once counts 1,
// and a build that flips on every frame the key is down counts near `HOLD_TICKS`.
// The resting band is asserted beside the count, so a build that flipped an even
// number of times cannot pass on the count alone.
//
// WHAT IS NOT ASSERTED. Which keys are bound to `b` at all is decided by
// `controls/flip-f`, `controls/flip-shift-left` and `controls/flip-shift-right`; the
// lockout a flip starts is `bands/flip-starts-lockout`'s and `ship/lockout-blocks-fire`'s.
// This point asserts the count and the resting band, and nothing else.
//
// THE WORLD IS EMPTY. `startPosed` clears the four rosters and shuts the wave's
// three gates, so nothing but the key can touch the band over the held second. No
// inversion is running either, and an inversion never swaps the ship's own band in
// any case (`specs/bands.md`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * The keys held: ALL THREE `specs/controls.md` binds the `b` action to, written out
 * as it states them rather than read off the build's `BINDINGS`.
 *
 * All three, and not one of them, because WHICH keys flip is decided elsewhere —
 * `controls/flip-f`, `controls/flip-shift-left` and `controls/flip-shift-right` own
 * one binding each. Holding a single key here would fail a build that wired the
 * other two on a point that is only about what a HELD flip acts like, charging one
 * fault twice. With all three down the action is held for any build that bound any
 * of them, so what this point reads is the count and nothing else.
 *
 * It is still ONE press. The engine arms an edge when a change takes the action's
 * resolved value from zero to non-zero, and "pressing a second key bound to an
 * already-held action is not a new press" (the engine's own `engine/input.md`), so
 * the three key-downs below arm exactly one edge between them — which is the whole
 * point: one press, and the specification says one flip.
 */
const FLIP_KEYS = ["KeyF", "ShiftLeft", "ShiftRight"] as const;

/** How long it is held: the second the point's own wording names. */
const HOLD_SECONDS = 1.0;
const HOLD_TICKS = ticksFor(HOLD_SECONDS);

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

afterEach(() => {
  h?.dispose();
});

it("flips the band once over a second of held flip, and not again", async () => {
  startPosed(h);
  const before = h.snapshot();
  assertEqual(before.screen, "inWave", "the wave the key is held in is live");
  assertEqual(before.ship.band, START_BAND, "the ship starts on cyan");

  let flips = 0;
  let band: string = before.ship.band;
  for (const key of FLIP_KEYS) h.hold(key);
  try {
    for (let tick = 0; tick < HOLD_TICKS; tick += 1) {
      await h.advance(1);
      const now: string = h.snapshot().ship.band;
      if (now !== band) flips += 1;
      band = now;
    }
  } finally {
    for (const key of FLIP_KEYS) h.release(key);
  }
  // Before the assertions, so a check that fails still leaves the picture of the
  // ship the held second left behind.
  captureStill(h, "once");

  assertEqual(
    flips,
    FLIPS_ALLOWED,
    `changes of the ship's band over ${String(HOLD_TICKS)} frames with the flip ` +
      "key held down — holding an edge action acts exactly once " +
      "(specs/controls.md)",
  );
  assertEqual(
    band,
    OPPOSITE_BAND,
    "the band the ship rested on when the key came up, which one flip from cyan " +
      "leaves at the opposite band (specs/bands.md)",
  );
});
