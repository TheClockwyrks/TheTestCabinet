// economy/early-send-bonus — sending pays one for every whole second left on the
// build timer.
//
// specs/economy.md's income table: the Early-send bonus line pays
// `EARLY_SEND_PER_SECOND` (`1`) "per whole second left on the build timer, which is
// `floor(buildTimer)`", "On sending a wave from a build phase". So a timer reading
// `9.4` pays `9`.
//
// `9.4` IS THE DISTINGUISHING VALUE. It sits four tenths past a whole second, so a
// build that pays the timer itself reads `9.4`, one that rounds up reads `10`, one
// that pays the seconds ALREADY SPENT rather than the seconds left reads `5` (the
// timer opens at `BUILD_PHASE_TIME`, `15`, per specs/waves.md), and one that pays
// nothing reads `0`. A whole-numbered timer would have hidden the first three of
// those.
//
// THE SEND IS THE PLAYER'S SEND. There is no operation on the debug surface that
// sends a wave — specs/instrumentation.md carries none, because the send is one of
// the actions specs/controls.md binds — so this point presses the key that action
// is bound to, read out of `BINDINGS`, and the bonus is paid by the build's own
// send code.
//
// THE PURSE IS POSED EMPTY, so the balance after the send is the payment itself and
// the reviewer reads the figure rather than a difference of two numbers.
//
// THE WORLD GATE STAYS SHUT, which `startRun` leaves it. specs/instrumentation.md
// puts "the build timer's automatic start of the next wave" and "the spawner's
// release of the units counted by `wavePending`" behind that gate and nothing else,
// so a MANUAL send still begins the wave and pays its bonus while no unit arrives
// to be killed or leaked and move the money underneath the reading.
//
// A SECOND FRAME IS RUN AFTER THE PRESS, and it is geometry rather than slack: `tap`
// delivers the edge and runs one frame, and a build may answer the press inside
// that frame or on the one after it, both conformant readings of a press edge
// (specs/controls.md). Two frames of the suite's 120 Hz clock are a sixtieth of a
// second of game time, so the timer the send reads is between `9.383` and `9.4`
// either way — the same whole second, and the same payment.
//
// WHAT EVERY WRONG MODEL READS is above. The distinguishing figure is `9`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, EARLY_SEND_PER_SECOND } from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";

/** The key specs/controls.md binds the send to. */
const SEND_KEY = BINDINGS.send[0];

/** The seconds posed on the build timer: four tenths past a whole second. */
const TIMER = 9.4;

/** The money the run holds going into the send: nothing at all. */
const PURSE = 0;

/**
 * What the send must pay, to the point.
 *
 * There is no tolerance on it and there cannot be one: money is a whole number and
 * specs/economy.md fixes the figure exactly, so the assertion is equality.
 */
const EXPECTED = EARLY_SEND_PER_SECOND * Math.floor(TIMER);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("pays 9 for a send with 9.4 seconds left on the build timer", async () => {
  startRun(h);
  h.debug.setBuildTimer(TIMER);
  h.debug.setMoney(PURSE);

  const before = h.snapshot().money;
  await h.tap(SEND_KEY);
  await h.advance(1);

  captureStill(h, "bonus");
  const after = h.snapshot().money;

  assertEqual(after - before, EXPECTED, "the money a send at 9.4 seconds paid");
});
