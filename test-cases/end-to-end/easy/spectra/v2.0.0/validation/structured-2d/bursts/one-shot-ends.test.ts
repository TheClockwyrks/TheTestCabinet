// Spectra — bursts/one-shot-ends: a burst is a one-shot.
//
// `specs/assets.md`, the drone-burst's "How long" rule: "A burst plays for
// `BURST_DURATION` (`0.7`) seconds and is then gone. Nothing loops or lingers."
// The file says the same of the system itself — it is "authored as a one-shot
// that bursts at the start and decays to an empty field by the end" — and
// `specs/instrumentation.md` reports the live bursts, so a burst that is gone is
// one that has left the roster.
//
// THE READING IS TAKEN AT BOTH ENDS OF THE SPAN, and it has to be. A build that
// drops a burst on the frame after it starts satisfies "is then gone" and plays
// nothing; a build that leaves it standing satisfies "plays for" and never ends.
// So the burst is asked for once BEFORE the span is up, where it must still be
// playing, and once AFTER, where it must be gone — and a build that failed
// either way names which of the two it did.
//
// AND ONCE MORE, A WHOLE SPAN LATER, for "nothing loops or lingers": a build
// whose one-shot restarts, or whose roster keeps a spent burst, is holding
// something a full `BURST_DURATION` past the end of its play. That last reading
// is on the WHOLE roster rather than on the one id, because a burst that looped
// by starting a fresh one carries a fresh id.
//
// WHY THE AGE IS THE FRAMES THIS SUITE DROVE, NOT THE BUILD'S `elapsed`.
// `firedPop` stops on the frame the burst appeared, so the burst is at most one
// frame of `10 ms` old when the drive begins and the span measured is the time
// the driven frames covered, give or take that frame. Both bounds below stand
// tens of frames clear of it.
//
// WHAT THIS DOES NOT DECIDE. What the burst holds while it plays is
// `bursts/from-provided-system`, and what it paints is `bursts/drawn`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertLength, assertUndefined } from "../assert";
import { BURST_DURATION } from "../constants";
import {
  burstById,
  captureStill,
  createHarness,
  poseDrone,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import { firedPop, poseBystander } from "./scene";

/**
 * How far the end of a burst's play may stand from `BURST_DURATION` (`0.7`), as
 * a fraction.
 *
 * A fifth, which is the latitude the specification's plain figure leaves a build
 * that ends its one-shot on the frame boundary its own loop happens to land on,
 * or that lets the last particles of the seeded system's `680 ms` spark
 * lifetimes finish. The two bounds it opens are `0.56` and `0.84` seconds, and
 * they are wide apart from the two wrong models this check exists for: a burst
 * dropped immediately, and one that never ends.
 */
const DURATION_TOLERANCE = 0.2;

/** The two moments the roster is read at, in seconds since the pop. */
const STILL_PLAYING_AT = BURST_DURATION * (1 - DURATION_TOLERANCE);
const GONE_BY = BURST_DURATION * (1 + DURATION_TOLERANCE);

/** Where the drone is posed: the clear stretch of field this group pops on. */
const POP_AT = { x: 1000, y: 460 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays for the burst's span, then leaves the roster and stays gone", async () => {
  startPosed(h);
  poseBystander(h);
  poseDrone(h, "shard", POP_AT.x, POP_AT.y, { band: "cyan" });

  const pop = await firedPop(h, POP_AT.x, POP_AT.y, "cyan");

  await h.advance(ticksFor(STILL_PLAYING_AT));
  assertDefined(
    burstById(h.snapshot(), pop.id),
    `the burst still playing ${STILL_PLAYING_AT.toFixed(2)}s after the pop, ` +
      `inside the BURST_DURATION (${BURST_DURATION}) it plays for ` +
      `(specs/assets.md)`,
  );

  await h.advance(ticksFor(GONE_BY) - ticksFor(STILL_PLAYING_AT));

  // The field the burst left behind.
  captureStill(h, "ended");

  assertUndefined(
    burstById(h.snapshot(), pop.id),
    `the burst gone from the roster ${GONE_BY.toFixed(2)}s after the pop ` +
      `(specs/assets.md: a burst plays for BURST_DURATION (${BURST_DURATION}) ` +
      `seconds and is then gone)`,
  );

  // A whole span further on, so a one-shot that looped has had time to restart
  // and a roster that lingers has had time to show it.
  await h.advance(ticksFor(BURST_DURATION));
  assertLength(
    h.snapshot().bursts,
    0,
    `the bursts playing a further ${BURST_DURATION}s on, with nothing having ` +
      `been destroyed since (specs/assets.md: nothing loops or lingers)`,
  );
});
