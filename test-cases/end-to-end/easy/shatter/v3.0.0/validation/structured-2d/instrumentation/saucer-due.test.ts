// instrumentation/saucer-due — `setSaucerDue` decides when the next saucer
// arrives.
//
// THE RULE. `specs/instrumentation.md`, "The saucer cadence":
// `setSaucerDue(seconds)` "sets `saucerDue`, the seconds `saucerClock` must reach
// for the next saucer to arrive, which is the figure the gap draw decides. It
// moves nothing else: `saucerClock` stands where it is."
//
// THE SCENARIO IS A GAME JUST BEGUN, where `reset` puts the cadence at the start
// and `saucerClock` at `0`, with the arrival gate on. The due is posed to three
// seconds, well short of the `18` a game begins with, and the field is watched:
// clear half a second before the due, a saucer up within a stride after it.
//
// THE STRIDE is a tenth of a second, and the arrival may be read up to one
// stride late, so the bound on when it came carries one stride at each end.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertCloseTo, assertEqual } from "../assert";
import { TICK_HZ } from "../constants";
import {
  captureStill,
  createHarness,
  seconds,
  ticksFor,
  type Harness,
} from "../harness";
import { openQuietGame } from "../saucer/visits";

/** The due posed, in seconds: short of a game's first delay by a wide margin. */
const POSED_DUE = 3;

/** How often the field is sampled: every tenth of a second. */
const STRIDE = TICK_HZ / 10;

/** The reading before the due: half a second short of it. */
const BEFORE_DUE = ticksFor(POSED_DUE - 0.5);

/** The decimal places the due is read back to: exactly. */
const READ_BACK_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  // The default clock: one tick a frame, so the arrival is read to a tick.
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("brings the next saucer in when the clock reaches the posed due", async () => {
  const opened = await openQuietGame(h);
  h.debug.setSaucerDue(POSED_DUE);
  const posed = h.snapshot();
  assertCloseTo(
    posed.saucerDue,
    POSED_DUE,
    READ_BACK_DIGITS,
    "setSaucerDue read back (specs/instrumentation.md)",
  );
  assertCloseTo(
    posed.saucerClock,
    seconds(opened),
    READ_BACK_DIGITS,
    "saucerClock standing where it was, at the start of the cadence " +
      "(specs/instrumentation.md)",
  );

  await h.quiet(() => h.advance(BEFORE_DUE - opened));
  assertEqual(
    h.snapshot().saucer,
    null,
    `the field half a second before the posed due of ${POSED_DUE} s ` +
      "(specs/instrumentation.md)",
  );

  const arrival = await h.until((snapshot) => snapshot.saucer !== null, {
    poll: STRIDE,
    maxFrames: ticksFor(1),
  });
  captureStill(h, "posed");
  assertEqual(
    arrival.hit,
    true,
    `a saucer on the field within a second of the posed due of ${POSED_DUE} s ` +
      "(specs/instrumentation.md)",
  );
  assertBetween(
    seconds(BEFORE_DUE + arrival.frames),
    POSED_DUE - seconds(STRIDE),
    POSED_DUE + seconds(STRIDE),
    "the seconds of game time the saucer arrived at, against the posed due " +
      "(specs/instrumentation.md)",
  );
});
