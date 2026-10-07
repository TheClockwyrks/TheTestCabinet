// Spectra — controls/pause-p: pressing `KeyP` in a live wave opens the
// paused screen.
//
// THE RULE. `specs/controls.md` binds the `pause` action to `Escape` and `KeyP`,
// reads it as a press edge, lists it among the actions the `inWave` screen reads,
// and says in as many words that "`pause` on the `inWave` screen opens the paused
// screen". This point decides one half of that binding: that the physical key
// `KeyP` is one of the keys which drives it. `controls/pause-escape` decides the other.
//
// THE UNAMBIGUOUS HALF OF THE BINDING. `KeyP` drives `pause` and nothing else,
// where `Escape` — the alternate, decided by `controls/pause-escape` — drives
// `back` as well. A build that read only `Escape` loses that point and this one
// separately, which is the right accounting for two independently wired keys.
//
// WHAT IS ASSERTED, AND WHAT IS NOT. That the press moved the game to the
// `paused` screen, and that it STAYED there — a press that opened the screen and
// let the next frame close it again has not paused anything, and the second half
// costs nothing to check because the clock is the harness's. What the paused screen
// draws is `screens/pause-menu-items`'; that the field behind it is frozen is
// `screens/pause-freezes`'; that the pause key pressed again resumes is
// `controls/pause-resumes`'. None of them is restated here.
//
// THE KEY IS A REAL ONE. `tap` presses the key down, runs exactly one frame with
// it held, and releases it, all through Chromium's own input pipeline — so what
// reaches the build is a browser-trusted DOM key event on the real page, and the
// frame between the down and the up makes the press visible to a build that
// compares held state between frames as well as to one that latches the edge in
// its handler. Under this engine there is no action layer between the page and the
// game (`specs/instrumentation.md` gives the surface no keyboard operation at
// all), so the whole path from a physical key to an opened screen is the build's.
//
// THE WORLD IS EMPTY. `startPosed` clears the four rosters and shuts the wave's
// three gates, so nothing on the field can change the screen underneath the press:
// no contact costs a life and opens the `ready` phase, no wave clears, and the
// only thing that moves the game off `inWave` is the key.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  startPosed,
  type Harness,
} from "../harness";

/**
 * How long the game is left on the opened screen before it is read again.
 *
 * Seven tenths of a second, which is long enough that a screen opened and closed
 * on the following frame — or blinking with the browser's key auto-repeat — shows
 * as something other than `paused` at the end of it.
 */
const SETTLE_SECONDS = 0.7;
const SETTLE_FRAMES = framesFor(SETTLE_SECONDS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the paused screen from a live wave when KeyP is pressed", async () => {
  await startPosed(h);
  const before = await h.snapshot();
  assertEqual(
    before.screen,
    "inWave",
    "the wave the key is pressed in is live",
  );
  assertEqual(
    before.phase,
    "live",
    "and the ship is flying rather than respawning",
  );

  await h.tap("KeyP");
  await captureStill(h, "paused");
  assertEqual(
    (await h.snapshot()).screen,
    "paused",
    "P opened the paused screen",
  );

  await h.advance(SETTLE_FRAMES);
  assertEqual(
    (await h.snapshot()).screen,
    "paused",
    `and it was still open ${SETTLE_SECONDS}s later, so the press opened a screen rather than blinking one`,
  );
});
