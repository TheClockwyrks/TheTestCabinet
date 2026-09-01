// bands/flip-instant — the flip changes band at once.
//
// specs/bands.md, "The flip": "The flip action changes the ship's band to the
// opposite one", and "The change is instant: the ship holds the other band in the
// frame the action is delivered". specs/controls.md binds that action to `b`,
// which is read as a press edge, "once per press".
//
// SO THE CHECK RUNS EXACTLY ONE FRAME. `h.tap` presses the key, releases it, and
// advances the single frame that delivers the edge; the band is read from the
// snapshot straight afterwards. That one frame is the whole of the requirement —
// a build that flips a frame later, or over a transition, holds `cyan` here.
//
// THE ACTION IS DELIVERED THROUGH THE REAL BINDING. Nothing poses the band: the
// key goes to the engine's own input and the game's own flip is what answers it,
// so this reads the action specs/controls.md fixes rather than the operation
// `setShipBand` that poses one.
//
// THE SHIP OPENS ON CYAN, which is where specs/bands.md starts a run and where
// `startPosed` leaves it, so the band read after the tap is `magenta` exactly
// when the flip happened.
//
// WHAT THIS DOES NOT DECIDE. That the same tap starts a fire lockout is
// `bands.flip-starts-lockout`'s point, and that each of `b`'s three keys reaches
// the action is the `controls` group's. This point reads one field, the ship's
// band, one frame after one press.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPosed,
  type Harness,
} from "../harness";

/** The band a run opens on, and the one the flip must leave the ship holding. */
const OPENING_BAND = "cyan" as const;
const FLIPPED_BAND = "magenta" as const;

/** The key bound to the flip action `b` (specs/controls.md, `BINDINGS`). */
const FLIP_KEY = BINDINGS.b[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the opposite band in the frame the flip is delivered", async () => {
  startPosed(h);
  h.debug.setShipBand(OPENING_BAND);

  const before = h.snapshot();
  assertEqual(
    before.screen,
    "inWave",
    "the screen the flip action is read on (specs/screens.md) — a flip " +
      "delivered anywhere else would prove nothing about this rule",
  );
  assertEqual(
    before.ship.band,
    OPENING_BAND,
    `the band the ship was posed on, which is the band the flip below has to ` +
      `move off; a ship already on ${FLIPPED_BAND} would read as flipped ` +
      "without flipping",
  );

  await h.tap(FLIP_KEY);
  captureStill(h, "flipped");

  assertEqual(
    h.snapshot().ship.band,
    FLIPPED_BAND,
    `the ship's band one frame after ${FLIP_KEY} was pressed and released, ` +
      `from ${OPENING_BAND} — specs/bands.md: the flip changes the ship's ` +
      "band to the opposite one, and the change is instant, so the ship holds " +
      "the other band in the frame the action is delivered",
  );
});
