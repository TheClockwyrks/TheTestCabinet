// instrumentation/sim-time-accumulates — `simTime` is the game's own clock, and
// it runs on every screen.
//
// THE RULE. specs/instrumentation.md reports `simTime` as "accumulated game
// time, in seconds", and notes that it "accumulates every update's delta,
// whatever the screen". specs/state.md says the same from the state's side:
// "Every update adds its delta, whatever the screen."
//
// WHY EVERY SCREEN. `lastPress.at` is a `simTime` reading, and the double-click
// window specs/controls.md fixes is measured against it, so a build whose clock
// stops outside play measures a double click against a clock that is not
// moving. The reading is therefore taken four times, once per screen, and each
// screen is named in its own failure.
//
// THE READING IS A DIFFERENCE, NOT A TOTAL, so nothing here assumes what
// `simTime` held when the screen was posed and a build is not held to a reset
// it was not asked for.
//
// THE TABLE IS EMPTY AND POSED ONCE. Nothing is dealt and no card is in flight,
// so no rule of the game can end a screen or start a cascade under the reading,
// and each second is a second of the clock alone. `setScreen` changes no other
// field (specs/instrumentation.md), so the four readings are the same table
// four times.
//
// THE TOLERANCE IS A FLOATING-POINT ONE. A second is covered as sixty frames of
// a sixtieth, and sixty additions of `1/60` in double precision land within a
// few parts in `10^15` of `1.0`; the bound below is far wider than that and far
// narrower than any way of being wrong — a build counting frames adds `60`, and
// one adding milliseconds adds `1000`.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  type Harness,
  type Screen,
} from "../harness";

/** The four screens the game moves between (specs/screens.md). */
const SCREENS: readonly Screen[] = ["title", "howto", "playing", "won"];

/** The span advanced on each screen, in seconds. */
const SPAN = 1;

/** Decimal places `simTime`'s gain is compared to `SPAN` at: a tolerance of 5e-7. */
const TOLERANCE_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("raises simTime by one second per second of game time, on every screen", async () => {
  openTable(h);

  for (const screen of SCREENS) {
    h.debug.setScreen(screen);
    const before = h.snapshot().simTime;
    await h.advanceSeconds(SPAN);
    const after = h.snapshot().simTime;

    assertCloseTo(
      after - before,
      SPAN,
      TOLERANCE_DIGITS,
      `seconds simTime gained over ${SPAN} s of game time on the ` +
        `${screen} screen: every update adds its delta, whatever the screen ` +
        "(specs/instrumentation.md)",
    );
  }

  await h.advance(1);
  captureStill(h, "advanced");
});
