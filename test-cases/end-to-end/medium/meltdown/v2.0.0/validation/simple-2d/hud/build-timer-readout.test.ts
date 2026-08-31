// hud/build-timer-readout — a build phase draws the seconds left on the build
// timer, and the figure falls as the timer does.
//
// THE RULE. specs/hud.md, The status readouts: "In a build phase the panel also
// draws the seconds left on the build timer, falling as the timer does."
// specs/waves.md gives the timer its length, and specs/instrumentation.md reports
// what is left of it as `buildTimer`.
//
// THE READING IS A FIGURE NEAR THE TIMER, NOT A SPELLING. specs/hud.md says the
// panel draws "the seconds left" and fixes no format, so a build may draw `"9.0s"`,
// `"9"`, `"8"` or `"9 SECONDS"`. So the check reads every figure the panel drew,
// takes the one nearest the timer the snapshot reports for the same frame, and
// requires it to sit within {@link ROUNDING} of it. That admits a figure floored,
// rounded or ceiled and refuses one that is a whole second and more adrift.
//
// TWO MOMENTS, BECAUSE THE FIGURE FALLS. A timer posed at {@link OPENED} seconds
// is read, {@link SPENT} seconds of the game's own clock are spent, and it is read
// again. The two readings are {@link SPENT} apart in the timer, so even with the
// rounding allowance at both ends the second reading has to be at least
// {@link FALL_MIN} below the first — which is what separates a countdown from a
// panel that letters the phase's length once and leaves it there.
//
// THE FIGURES CARRY NOTHING ELSE ON THE PANEL. Beside the countdown the strip
// holds the money, the lives, the wave over its total, the eight shop costs and
// the coming wave's count, and no two of those sit within {@link ROUNDING} of
// either `9` or `3`: the money, the lives and the wave are posed to figures that
// do not, and the wave posed makes the preview's count 28.
//
// NOTHING ELSE MOVES UNDER THE WINDOW. `startRun` leaves the world gate shut, so
// the timer running down starts no wave and releases nothing
// (specs/instrumentation.md, The world gate), and the floor is empty, so no
// bounty, clear bonus or leak can move a readout beside the one being read
// (specs/economy.md).
//
// WHAT IT DOES NOT DECIDE. How long a build phase runs and what happens when it
// expires are `waves.*`. This point decides that the panel draws what is left of
// it.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThan, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  ticksFor,
  type Harness,
} from "../harness";
import { nearestNumber, readPanel, textsOf } from "./read";

/** The run the panel is read on, and the wave posed under the reading. */
const MODE = "containment";
const DIFFICULTY = "hard";
const WAVE = 7;

/** The money and the lives posed under the reading, carrying no `9` and no `3`. */
const MONEY = 9999;
const LIVES = 17;

/** The seconds the timer is posed at for the first reading. */
const OPENED = 9;

/** The seconds of the game's own clock spent between the two readings. */
const SPENT = 6;

/**
 * How far the drawn figure may sit from the seconds the snapshot reports for the
 * same frame.
 *
 * specs/hud.md asks for "the seconds left" and fixes no precision, so a build may
 * floor, round or ceil the remainder to a whole second, which moves the figure by
 * up to one second either way. A hundredth is added for the float noise in a
 * remainder that is a sum of frame deltas.
 */
const ROUNDING = 1.01;

/**
 * How far the second reading must sit below the first.
 *
 * The timer fell by {@link SPENT} between them, and each reading may be
 * {@link ROUNDING} adrift of its own timer, so a countdown drawn at any precision
 * clears this by a wide margin while a figure that never moves fails it outright.
 */
const FALL_MIN = SPENT - 2 * ROUNDING;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the seconds left on the build timer, falling as the timer does", async () => {
  startRun(h, MODE, DIFFICULTY);
  h.debug.setMoney(MONEY);
  h.debug.setLives(LIVES);
  h.debug.setWave(WAVE);
  h.debug.setBuildTimer(OPENED);

  const openedRuns = (await readPanel(h)).info;
  captureStill(h, "timer");
  const openedTimer = h.snapshot().buildTimer;
  const openedRead = nearestNumber(
    openedRuns,
    openedTimer,
    `a figure in the build panel reading the seconds left on the build timer, ` +
      `which specs/hud.md draws in a build phase`,
  );

  assertLessThanOrEqual(
    Math.abs(openedRead - openedTimer),
    ROUNDING,
    `how far the panel's nearest figure sits from the ` +
      `${openedTimer.toFixed(3)} s the build timer had left on that frame ` +
      `(specs/hud.md, The status readouts); the panel drew ` +
      `${JSON.stringify(textsOf(openedRuns))}`,
  );

  await h.advance(ticksFor(SPENT));

  const spentRuns = (await readPanel(h)).info;
  const spentTimer = h.snapshot().buildTimer;
  const spentRead = nearestNumber(
    spentRuns,
    spentTimer,
    `a figure in the build panel reading the seconds left on the build timer ` +
      `${SPENT} s later (specs/hud.md)`,
  );

  assertLessThanOrEqual(
    Math.abs(spentRead - spentTimer),
    ROUNDING,
    `how far the panel's nearest figure sits from the ` +
      `${spentTimer.toFixed(3)} s the build timer had left ${SPENT} s later ` +
      `(specs/hud.md); the panel drew ${JSON.stringify(textsOf(spentRuns))}`,
  );
  assertLessThan(
    spentRead - openedRead,
    -FALL_MIN,
    `how far the drawn countdown moved over ${SPENT} s of the game's own ` +
      `clock: it read ${openedRead} and then ${spentRead}, and specs/hud.md ` +
      `has it "falling as the timer does"`,
  );
});
