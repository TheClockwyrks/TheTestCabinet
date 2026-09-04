// Spectra — controls/discharge-x: with the meter full, `KeyX` starts the discharge
// wave.
//
// THE RULE. `specs/controls.md` binds the `discharge` action to `KeyX` alone, reads
// it as a press EDGE, and lists it among the actions the `inWave` screen reads.
// `specs/resonance.md` says the action, taken with the meter at `RESONANCE_MAX`,
// "Sets the meter to `0` and starts the wave below" — a circle centred on the ship,
// live for `DISCHARGE_TIME` seconds, reported by the snapshot as `discharge.active`.
// This point decides the KEY and nothing else: that `KeyX`, with the meter full,
// releases the wave.
//
// ONE BEHAVIOUR IS GRADED ONCE. That the release SPENDS the meter is
// `resonance/discharge-spends`'s; that the wave's radius grows from `0` to
// `DISCHARGE_MAX_R` over `DISCHARGE_TIME` is `resonance/discharge-duration`'s; that a
// discharge below `RESONANCE_MAX` does nothing is `resonance/discharge-locked`'s;
// what the wave destroys and spares is the rest of `resonance`'s and `scoring`'s. A
// build whose key is wired correctly and whose meter accounting is wrong must lose
// those points and keep this one — v1.0.0's counterpart failed exactly that way, and
// this suite asserts `discharge.active` alone.
//
// THE PRECONDITION IS POSED, NOT PLAYED INTO. `specs/instrumentation.md` gives
// `setResonance` for exactly this, so the meter is put at `RESONANCE_MAX` directly
// rather than by absorbing sixteen enemy bullets — a route that would drag the
// shield, the band rules and the ship's contact test into a point about a key.
// `dischargeReady` is deliberately NOT asserted as a precondition: it is a derived
// reading and `instrumentation/snapshot-shape` grades it, so a build whose
// derivation is broken should fail there rather than here.
//
// THE KEY IS TAPPED, AND IT IS A REAL ONE. `specs/controls.md` reads `discharge` as
// an edge, so a conforming build resolves it through the engine's `pressed`: `tap`
// presses the key, releases it, and runs the one frame that delivers the armed edge,
// which is exactly what the engine's input frame carries. The event is a
// `KeyboardEvent`-shaped one dispatched at the engine's own event target, which the
// engine resolves exactly as it resolves a player's key. `specs/instrumentation.md`
// gives the surface no operation that discharges — "A caller checking the discharge
// poses the meter and drives the discharge action" — so the whole path from a
// physical key to a live wave, the registration included, is the build's own and all
// of it is exercised. The code below is the LITERAL `specs/controls.md` states rather
// than `BINDINGS.discharge[0]`: that table is the build's own copy of the very thing
// this point decides.
//
// THE WORLD IS EMPTY. `startPosed` clears the four rosters and shuts the wave's three
// gates, so the discharge reaches nothing: no drone is destroyed, no score is paid,
// no burst plays, and what is read back is the wave itself rather than its
// consequences.

import { afterEach, beforeEach, it } from "vitest";
import { DISCHARGE_TIME, RESONANCE_MAX } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/** The one key `specs/controls.md` binds `discharge` to, written out as it states it. */
const DISCHARGE_KEY = "KeyX";

/**
 * Frames run after the press purely so the still shows a wave with a radius.
 *
 * A fifth of `DISCHARGE_TIME` (`0.5` s), so the wave is unmistakably mid-flight and
 * unmistakably still live. The verdict is read from the snapshot taken on the press
 * frame, before these run, so nothing here can decide it.
 */
const EVIDENCE_TICKS = ticksFor(DISCHARGE_TIME / 5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("releases the wave when KeyX is pressed with the meter full", async () => {
  startPosed(h);
  h.debug.setResonance(RESONANCE_MAX);

  const armed = h.snapshot();
  assertEqual(armed.screen, "inWave", "the wave the key is pressed in is live");
  assertEqual(
    armed.phase,
    "live",
    "and the ship is flying rather than respawning",
  );
  assertEqual(
    armed.discharge.active,
    false,
    "whether a discharge wave was already running before the press",
  );

  await h.tap(DISCHARGE_KEY);
  const released = h.snapshot();

  await h.advance(EVIDENCE_TICKS);
  // After the evidence frames and before the assertion, so the picture shows a
  // wave with a radius and a check that fails still leaves it behind.
  captureStill(h, "discharge");

  assertEqual(
    released.discharge.active,
    true,
    `whether a discharge wave was running one frame after KeyX was pressed with ` +
      `the meter at ${String(RESONANCE_MAX)} (specs/controls.md, ` +
      "specs/resonance.md)",
  );
});
