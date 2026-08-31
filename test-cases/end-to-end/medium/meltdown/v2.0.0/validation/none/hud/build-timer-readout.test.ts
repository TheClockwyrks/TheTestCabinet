// hud/build-timer-readout — a build phase draws the seconds left, and they fall
// with the timer.
//
// `specs/hud.md`, The status readouts: "In a build phase the panel also draws the
// seconds left on the build timer, falling as the timer does." The timer itself is
// `specs/waves.md`'s: it "falls by one second per second of game time".
//
// WHY THE READING IS A WINDOW AND NOT A NUMBER. Nothing fixes how the seconds are
// drawn, and a build is free to round them down, up, or to nearest — `13`, `14`
// and `13.4` are all "the seconds left" on a timer standing at `13.39`. So each
// sample accepts a number within {@link ROUNDING} of the timer the snapshot
// reports at that moment, and the two windows are placed four seconds apart, far
// enough that neither contains the other's value.
//
// THE FALL IS WHAT MAKES IT A COUNTDOWN. A panel drawing a fixed `15` would sit
// inside the first window and, four seconds later, outside the second, so the
// second sample requires the first window's figures to be GONE as well as the
// second window's to be there.
//
// WHY THE SECOND WAVE. On Wave 1 the coming wave releases twelve Motes and the
// preview draws that `12`, which falls inside the second window; on Wave 2 it
// releases fifteen, which does not. The wave the timer belongs to is nothing this
// point is about, so it is posed where the preview cannot answer for the
// countdown.
//
// THE WORLD GATE STAYS SHUT, as `startRun` leaves it: with it off "a build timer
// driven to `0` leaves the phase where it stands" and "the timer still counts
// down" (`specs/instrumentation.md`), so the four seconds spent here cannot start
// a wave and change the phase out from under the reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { captureStill, createHarness, startRun, type Harness } from "../harness";
import { readPanel, readsWithin } from "./panel";

/** The wave the build phase belongs to; see the header. */
const WAVE = 2;

/** The seconds posed on the timer, off an integer so no rounding is favoured. */
const POSED = 17.4;

/** The game time the timer is then let fall by, in seconds. */
const FALL = 4;

/**
 * How far a drawn figure may sit from the live timer and still be the seconds
 * left: one second.
 *
 * The seconds left may be drawn rounded down, up or to nearest, and the three
 * differ by at most one, so a figure within a second of the timer is the seconds
 * left drawn under some one of them. It is a reading tolerance and nothing else:
 * the two samples are four seconds apart, so a build whose countdown does not
 * move fails the second sample by three.
 */
const ROUNDING = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws the seconds left in a build phase, falling with the timer", async () => {
  await startRun(h);
  await h.debug.setWave(WAVE);
  await h.debug.setBuildTimer(POSED);

  const first = await readPanel(h);
  const opened = await h.snapshot();
  await captureStill(h, "timer");

  await h.skip(FALL);
  const second = await readPanel(h);
  const fallen = await h.snapshot();

  assertEqual(opened.phase, "building", "precondition: the phase is a build phase");
  assertEqual(fallen.phase, "building", "precondition: the phase is still a build phase");
  assertTrue(
    readsWithin(first, opened.buildTimer - ROUNDING, opened.buildTimer + ROUNDING),
    `the panel to draw the ${opened.buildTimer.toFixed(2)} seconds left on the build timer`,
  );
  assertTrue(
    readsWithin(second, fallen.buildTimer - ROUNDING, fallen.buildTimer + ROUNDING),
    `the panel to draw the ${fallen.buildTimer.toFixed(2)} seconds left after ${FALL} seconds of game time`,
  );
  assertTrue(
    !readsWithin(
      second,
      opened.buildTimer - ROUNDING,
      opened.buildTimer + ROUNDING,
    ),
    `the panel to have stopped drawing the ${opened.buildTimer.toFixed(2)} it opened on`,
  );
});
