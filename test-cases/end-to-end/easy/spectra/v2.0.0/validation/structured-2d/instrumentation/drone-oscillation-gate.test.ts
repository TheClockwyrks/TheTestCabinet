// instrumentation/drone-oscillation-gate — a Flux whose oscillation is gated off
// holds its band, its band clock and its shimmer for a whole cycle, while
// travelling as usual.
//
// specs/instrumentation.md gives the operation exactly one faculty:
// `setDroneOscillation(id, enabled)` "Gates a Flux's band clock alone. Off, the
// Flux holds whichever band or shimmer it is in indefinitely. Its travel and its
// firing run on."
//
// IT IS WHAT LETS A SCENARIO PUT A FLUX ON A CHOSEN BEAT AND KEEP IT THERE.
// specs/drones.md runs a Flux's band clock with game time, flipping the stored
// band and returning the clock to `0` every `fluxWindow(stage)` — `2.0` s at stage
// 1 — so without this gate a Flux posed on a band is on the other one two seconds
// later, and any check that shoots at one, reads its colour, or counts it toward a
// formation's bands is reading whichever beat the frame happened to land on.
//
// A FULL CYCLE IS THE SPAN, AND THAT IS THE POINT. `fluxCycle(1)` is
// `2 * fluxWindow(1)`, `4.0` s: long enough for a conforming build's clock to
// cross the end of its window TWICE and return the stored band to where it
// started. So a build whose gate does nothing reads a different clock throughout
// and a shimmer for two windows out of every five, and only a build that really
// stopped the clock reads the same three values at the end as at the start.
//
// THE POSED CLOCK IS THE DISTINGUISHING VALUE. `0.7` s is inside the held part of
// the window (`fluxHold(1)` is `1.6` s) and is not `0`, so each wrong model reads
// as a different number: a build that runs the clock anyway reads `2.7 - 2.0`,
// which is `0.7` again but with the stored band FLIPPED TWICE and the shimmer
// having come and gone — which is why the band and the shimmer are read beside the
// clock rather than the clock alone; a build that zeroes the clock when the gate
// closes reads `0`; a build that holds the drone's whole update reads `0.7` with
// the drone still where it was, which the travelling half below separates.
//
// AND THE FLUX TRAVELS THROUGHOUT, which is the isolation the operation names: its
// travel "runs on" while its band clock is held, so the drone is posed resting in
// its slot with travel ON, riding the sway specs/field.md fixes. A check that
// gated the travel too would be reading a frozen drone rather than a held clock.
//
// WHAT THIS DOES NOT DECIDE. The rhythm itself — that the clock runs, that the
// window turns over at `fluxWindow(stage)`, and that a shimmering Flux reads as
// the band it is moving toward — which are `drones.flux-cycle-holds`,
// `drones.flux-shimmer-duration` and `drones.flux-emerges-opposite`.

import { afterEach, beforeEach, it } from "vitest";
import { fluxCycle, fluxHold, fluxWindow } from "../constants";
import { assertCloseTo, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";
import { requireDrone } from "./crowded-field";

/**
 * The stage the window is read at, and whose figures the span below comes from.
 *
 * `startPosed` opens the field at stage 1, and every figure below is read from
 * the stage-1 formulas specs/stages.md states.
 */
const STAGE = 1;

/** Where the Flux rests: a slot of its own, clear of both HUD strips. */
const FLUX_AT = { x: 640, y: 200 } as const;

/** The band it is posed holding. */
const BAND = "cyan" as const;

/**
 * How far into its band window the Flux is posed, in seconds.
 *
 * `0.7`, which is inside the held part of the window — `fluxHold(1)` is `1.6` s
 * (specs/stages.md) — and is neither `0` nor the boundary, so a build that zeroed
 * the clock when the gate closed and a build that ran it anyway each read as a
 * different number.
 */
const BAND_CLOCK = 0.7;

/** How long the gated Flux is left running, in seconds: a whole cycle. */
const SPAN_SECONDS = fluxCycle(STAGE);

/**
 * How far the held band clock may sit from where it was posed, in decimal digits
 * for `assertCloseTo` — six, which is half a millionth of a second.
 *
 * The specification holds the Flux "indefinitely", so this is the float noise of
 * reading a number back rather than an allowance for drift: a build advancing
 * even a hundredth of the span misses it by four hundredths of a second.
 */
const HOLD_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds a gated Flux's band, band clock and shimmer for a whole cycle", async () => {
  startPosed(h);

  // Resting in its slot with its travel ON, which the operation leaves running.
  const flux = poseDrone(h, "flux", FLUX_AT.x, FLUX_AT.y, {
    band: BAND,
    bandClock: BAND_CLOCK,
    phase: "formation",
    travel: true,
    oscillation: false,
  });

  const posed = requireDrone(h.snapshot(), flux, "the gated Flux");
  assertEqual(
    posed.shimmer,
    false,
    `whether the Flux was shimmering at the moment it was posed, ` +
      `${BAND_CLOCK} s into a window whose held part is fluxHold(${STAGE}) = ` +
      `${fluxHold(STAGE)} s (specs/drones.md) — the reading below is of a Flux ` +
      `holding its band`,
  );

  await h.advanceSeconds(SPAN_SECONDS);
  // Before the assertions, so a failing gate still leaves the picture of the Flux
  // the closed gate held.
  captureStill(h, "held");

  const held = requireDrone(h.snapshot(), flux, "the gated Flux");
  assertEqual(
    held.band,
    BAND,
    `the Flux's stored band after fluxCycle(${STAGE}) = ${SPAN_SECONDS} s of ` +
      `game time with setDroneOscillation(${flux}, false) held — its window is ` +
      `fluxWindow(${STAGE}) = ${fluxWindow(STAGE)} s, so an ungated clock ` +
      `would have turned it over twice (specs/drones.md)`,
  );
  assertCloseTo(
    held.bandClock,
    BAND_CLOCK,
    HOLD_DIGITS,
    `the Flux's band clock, in seconds into its current window, after that ` +
      `same span — the gate holds the clock alone, and it was posed at ` +
      `${BAND_CLOCK}`,
  );
  assertEqual(
    held.shimmer,
    false,
    `whether the Flux is shimmering after that same span — it is settled on ` +
      `${BAND} with its clock below fluxHold(${STAGE}) (${fluxHold(STAGE)} s), ` +
      `and a held clock never carries it into a shimmer (specs/drones.md)`,
  );
});
