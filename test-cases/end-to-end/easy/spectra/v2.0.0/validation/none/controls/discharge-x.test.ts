// Spectra — controls/discharge-x: with the meter full, `KeyX` starts the
// discharge wave.
//
// THE RULE. `specs/controls.md` binds the `discharge` action to `KeyX` alone,
// reads it as a press edge, and lists it among the actions the `inWave` screen
// reads. `specs/resonance.md` says the action, taken with the meter at
// `RESONANCE_MAX`, "starts the wave below" — a circle centred on the ship, live for
// `DISCHARGE_TIME` seconds, reported by the snapshot as `discharge.active`. This
// point decides the KEY and nothing else: that `KeyX`, with the meter full,
// releases the wave.
//
// ONE BEHAVIOUR IS GRADED ONCE. That the release SPENDS the meter is
// `resonance/discharge-spends`; that the wave's radius grows from 0 to
// `DISCHARGE_MAX_R` over `DISCHARGE_TIME` is `resonance`'s; that a discharge below
// `RESONANCE_MAX` does nothing is `resonance`'s; what the wave destroys is
// `resonance`'s and `scoring`'s. A build whose key is wired correctly and whose
// meter accounting is wrong must lose those points and keep this one — v1.0.0's
// counterpart failed exactly that way, and this suite asserts `discharge.active`
// alone.
//
// THE PRECONDITION IS POSED, NOT PLAYED INTO. `specs/instrumentation.md` gives
// `setResonance` for exactly this, so the meter is put at `RESONANCE_MAX` directly
// rather than by absorbing sixteen enemy bullets — a route that would drag the
// shield, the band rules and the ship's contact test into a point about a key.
// `dischargeReady` is deliberately NOT asserted as a precondition: it is a derived
// reading and `instrumentation/snapshot-shape` grades it, so a build whose
// derivation is broken should fail there rather than here.
//
// THE KEY IS A REAL ONE. `tap` presses the key down, runs exactly one frame with
// it held, and releases it, all through Chromium's own input pipeline. Under this
// engine there is no action layer between the page and the game, and
// `specs/instrumentation.md` gives the surface no operation that discharges — "A
// caller checking the discharge poses the meter and drives the discharge action" —
// so the whole path from a physical key to a live wave is the build's own.
//
// THE WORLD IS EMPTY. `startPosed` clears the four rosters and shuts the wave's
// three gates, so the discharge reaches nothing: no drone is destroyed, no score
// is paid, no burst plays, and what is read back is the wave itself rather than
// its consequences.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { DISCHARGE_TIME, RESONANCE_MAX } from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  startPosed,
  type Harness,
} from "../harness";

/** The one key `specs/controls.md` binds `discharge` to. */
const DISCHARGE_KEY = "KeyX";

/**
 * Frames run after the press purely so the still shows a wave with a radius.
 *
 * A fifth of `DISCHARGE_TIME` (0.5 s), so the wave is unmistakably mid-flight and
 * unmistakably still live. The verdict is read from the snapshot taken on the
 * press frame, before these run, so nothing here can decide it.
 */
const EVIDENCE_FRAMES = framesFor(DISCHARGE_TIME / 5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("releases the wave when KeyX is pressed with the meter full", async () => {
  await startPosed(h);
  await h.debug.setResonance(RESONANCE_MAX);

  const armed = await h.snapshot();
  assertEqual(armed.screen, "inWave", "the wave the key is pressed in is live");
  assertEqual(
    armed.discharge.active,
    false,
    "no discharge is running before the press",
  );

  await h.tap(DISCHARGE_KEY);
  const released = await h.snapshot();

  await h.advance(EVIDENCE_FRAMES);
  await captureStill(h, "discharge");

  assertEqual(
    released.discharge.active,
    true,
    `KeyX started the discharge wave with the meter at ${RESONANCE_MAX}`,
  );
});
