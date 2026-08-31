// Spectra — controls/flip-shift-right: pressing `ShiftRight` flips the ship's band.
//
// THE RULE. `specs/controls.md` binds the `b` action — "Flips the ship's band." —
// to `KeyF`, `ShiftLeft` and `ShiftRight`, reads `b` as a press edge, and lists
// it among the actions the `inWave` screen reads. `specs/bands.md` says the flip
// changes the ship's band to THE OPPOSITE ONE, in the frame the action is
// delivered. This point decides one third of that binding: that the physical key
// `ShiftRight` is one of the keys which drives it. `controls/flip-f` and `controls/flip-shift-left`
// decide the other two, so a build that wired some and not all loses exactly the
// points it missed.
//
// WHY THE KEY IS PRESSED TWICE. Once is not enough to tell a flip from a latch: a
// build whose `ShiftRight` writes `magenta` rather than the opposite band passes a
// single press and is not flipping anything. The ship starts each run on `cyan`
// (`specs/bands.md`), so the two presses run cyan → magenta → cyan, and each wrong
// model reads differently — a build that does nothing stays on cyan, a build that
// latches magenta stays there, and only a build that takes the opposite band each
// time lands back on cyan. A standing lockout is no obstacle to the second press:
// `specs/bands.md` says a flip made while a lockout stands RESTARTS the lockout,
// so nothing blocks a flip.
//
// WHAT IS NOT ASSERTED. The `FLIP_LOCKOUT` the flip starts, and what it does to
// the cannon, are graded once each in `bands` and `ship`; the frame the polarity
// indicator follows the flip on is `screens/hud-polarity-indicator`'s. Restating
// any of them would cost one build two points for one fault.
//
// THE KEY IS A REAL ONE. `tap` presses the key down, runs exactly one frame with
// it held, and releases it, all through Chromium's own input pipeline — so what
// reaches the build is a browser-trusted DOM key event on the real page, and the
// frame between the down and the up is what makes the press visible to a build
// that compares held state between frames as well as to one that latches the edge
// in its handler. Under this engine there is no action layer between the page and
// the game (`specs/instrumentation.md` gives the surface no keyboard operation and
// no operation that flips), so the whole path from a physical key to a changed
// band is the build's own.
//
// THE WORLD IS EMPTY. `startPosed` clears the four rosters and shuts the wave's
// three gates, so no contact, no inversion and no drone can touch the band while
// the presses land. The ship's OWN band is never swapped by an inversion in any
// case (`specs/bands.md`), and none is running here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPosed,
  type Harness,
} from "../harness";

/** The band a run — and `startPosed` — puts the ship on (`specs/bands.md`). */
const START_BAND = "cyan";
/** The only other band there is, which is what "the opposite" means here. */
const OPPOSITE_BAND = "magenta";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes the ship to the opposite band on each ShiftRight press", async () => {
  await startPosed(h);
  const before = await h.snapshot();
  assertEqual(
    before.screen,
    "inWave",
    "the wave the key is pressed in is live",
  );
  assertEqual(before.ship.band, START_BAND, "the ship starts on cyan");

  await h.tap("ShiftRight");
  await captureStill(h, "flipped");
  assertEqual(
    (await h.snapshot()).ship.band,
    OPPOSITE_BAND,
    "Right Shift took the ship to the opposite band",
  );

  await h.tap("ShiftRight");
  assertEqual(
    (await h.snapshot()).ship.band,
    START_BAND,
    "and back again on the second press, so it flips rather than latches",
  );
});
