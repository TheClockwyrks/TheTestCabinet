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
// THE CLOCK IS READ BEFORE THE POSE AND AFTER IT, and the two readings are held
// to each other: "stands where it is" is a claim about the operation, so the
// figure it is checked against is the clock the build reported the moment
// before, whatever that was. The game is opened by a real `confirm`, and the
// specs fix the order of work inside a tick, not whether the frame that carries
// the confirm steps its ticks before or after the key is applied — so a build
// may report the clock at one tick or at `0` here, and either is right. Every
// later moment is counted from that reading rather than from the harness's
// frame count.
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
  const standing = h.snapshot().saucerClock;
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
    standing,
    READ_BACK_DIGITS,
    "saucerClock standing where it was the moment before the due was posed " +
      "(specs/instrumentation.md)",
  );

  // Half a second short of the due, counted on the build's own clock.
  const beforeDue = BEFORE_DUE - opened;
  await h.quiet(() => h.advance(beforeDue));
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
    standing + seconds(beforeDue + arrival.frames),
    POSED_DUE - seconds(STRIDE),
    POSED_DUE + seconds(STRIDE),
    "the seconds the cadence had run when the saucer arrived, against the " +
      "posed due (specs/instrumentation.md)",
  );
});
