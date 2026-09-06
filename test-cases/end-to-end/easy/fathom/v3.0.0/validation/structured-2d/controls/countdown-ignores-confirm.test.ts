// controls/countdown-ignores-confirm — the countdown reads nothing but mute.
//
// specs/movement.md's "Where each action is read" table gives `"countdown"` the
// `mute` action alone. So the two keys that do the most on the screens either
// side of it — `Space`, which fires the pulse in live play and takes a menu item
// on a menu, and `Enter`, which takes a menu item — must do nothing at all while
// the countdown runs.
//
// THE READING IS A COMPARISON OF TWO COUNTDOWNS, because "does nothing" has no
// single reading of its own, and specs/ui.md fixes the countdown at one length
// per build, "the same length on every countdown". One countdown is timed with
// nothing touched, and a second, on a fresh reset, is timed with both keys
// pressed through it. A build that let either key shorten
// the hold gives way at a different simulated time; a build that let `Space`
// reach the pulse has a wavefront in flight the untouched run does not.
//
// BOTH KEYS ARE PRESSED REPEATEDLY, at a cadence well inside the hold, so a build
// that reads an edge on some other frame of the countdown still meets one. Each
// press is a real key event through the game's own input path.
//
// The two spans are compared to the measurement's own slack and no more: the
// countdown begins DURING the tick that poses the screen and gives way DURING the
// tick after the last one sampled, so each span is the true hold to within two
// ticks, and the difference between two of them to within four.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual, assertLength, assertLessThanOrEqual } from "../assert";
import { BINDINGS, HOLD_MAX, TICK_HZ } from "../constants";
import {
  captureReplay,
  createHarness,
  openTitle,
  type Harness,
} from "../harness";
import type { FathomSnapshot } from "../surface";
import { ticksFor } from "../harness";

/** The two keys the screens either side of the countdown act on. */
const SONAR_KEY = BINDINGS.a[0];
const CONFIRM_KEY = BINDINGS.confirm[0];

/**
 * The ceiling on each watch, in ticks.
 *
 * specs/ui.md gives the countdown at most `HOLD_MAX` (`3 s`), so a build whose
 * countdown never gives way fails on the bound rather than running until the
 * suite times out.
 */
const MAX_HOLD_TICKS = ticksFor(HOLD_MAX) + 2;

/** How often the pressed run presses each key, in ticks: five times a second. */
const PRESS_EVERY = TICK_HZ / 5;

/**
 * How far the two spans may differ, in seconds.
 *
 * Four ticks: two of measurement slack on each of the two watches, and nothing
 * more. A key that shortened the countdown by even a tenth of a second lands far
 * outside it.
 */
const SPAN_SLACK = 4 / TICK_HZ;

/** What one timed countdown left behind. */
interface Timed {
  /** Simulated seconds between posing the screen and play beginning. */
  span: number;
  /** The first snapshot taken once the countdown had given way. */
  after: FathomSnapshot;
}

/**
 * Pose a countdown on a fresh reset and time it, pressing `keys` at a
 * steady cadence through it where any are named.
 *
 * The screen is posed straight through `setScreen`, because a dive REACHING the
 * countdown is `states.dive-opens-countdown`'s point.
 */
async function timeCountdown(
  harness: Harness,
  keys: readonly string[] = [],
): Promise<Timed> {
  harness.debug.reset();
  harness.debug.setScreen("countdown");
  const opened = harness.snapshot();
  for (let step = 1; step <= MAX_HOLD_TICKS; step += 1) {
    if (keys.length > 0 && step % PRESS_EVERY === 0) {
      for (const key of keys) await harness.tap(key);
    } else {
      await harness.advance(1);
    }
    const now = harness.snapshot();
    if (now.screen !== "countdown") {
      return { span: now.simTime - opened.simTime, after: now };
    }
  }
  return {
    span: Number.NaN,
    after: harness.snapshot(),
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("runs the countdown to its own length under Space and Enter", async () => {
  openTitle(h);
  const untouched = await timeCountdown(h);
  assertEqual(
    untouched.after.screen,
    "playing",
    `the untouched countdown gives way inside ${String(HOLD_MAX)} s ` +
      "(specs/ui.md)",
  );

  const pressed = await captureReplay(h, "ignored", () =>
    timeCountdown(h, [SONAR_KEY, CONFIRM_KEY]),
  );

  assertEqual(
    pressed.after.screen,
    "playing",
    `the pressed countdown gives way inside ${String(HOLD_MAX)} s, to live ` +
      "play and to nothing else (specs/movement.md)",
  );
  assertLessThanOrEqual(
    Math.abs(pressed.span - untouched.span),
    SPAN_SLACK,
    `simulated seconds between the countdown held with ${SONAR_KEY} and ` +
      `${CONFIRM_KEY} pressed through it and the ` +
      `${untouched.span.toFixed(3)} it held for untouched — the countdown ` +
      "reads the mute action alone (specs/movement.md)",
  );
  assertLength(
    pressed.after.pulses,
    0,
    `wavefronts in flight after ${SONAR_KEY} was pressed through the ` +
      "countdown, which reads the mute action alone (specs/movement.md)",
  );
});
