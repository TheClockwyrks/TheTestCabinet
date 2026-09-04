// Spectra — controls/fire-space: pressing `Space` in a live wave fires.
//
// THE RULE. `specs/controls.md` binds the `a` action — "Fires." — to `Space`,
// `ArrowUp` and `KeyW`, and lists `a` among the actions the `inWave` screen
// reads. `specs/ship.md` says a shot is one of the player's bullets, leaving the
// ship's nose. This point decides one third of that binding: that the physical key
// `Space` is one of the keys which fires. `controls/fire-up` and `controls/fire-w` decide the other two, so a
// build that wired some and not all loses exactly the points it missed.
//
// ONE KEY, TWO ACTIONS, AND THE SCREEN DECIDES. `Space` drives `a` and
// `confirm`, and `specs/controls.md` settles the collision with its table of what
// each screen reads: the `inWave` screen reads `a` and does not read `confirm`.
// Pressing the real key rather than raising an action is what puts that ambiguity
// in front of the build, and a live wave is where the `a` reading has to win.
// `controls/confirm-space` decides the same key's other reading on the title.
//
// WHAT IS ASSERTED, AND WHAT IS NOT. That the press put ONE of the player's
// bullets on a field that held none. Where that bullet appears, how fast it
// climbs, what band it carries, and what the cadence, the cap and the lockout do
// to a second shot are each graded once in the `ship` category; restating any of
// them here would cost one build two points for one fault.
//
// THE KEY IS A REAL ONE. `tap` presses the key down, runs exactly one frame with
// it held, and releases it, all through Chromium's own input pipeline — so what
// reaches the build is a browser-trusted DOM key event on the real page, and the
// frame between the down and the up is what makes the press visible to a build
// that reads its keyboard by comparing held state between frames as well as to one
// that latches the edge in the handler. Under this engine there is no action layer
// between the page and the game (`specs/instrumentation.md` gives the surface no
// keyboard operation at all), so the whole path from a physical key to a bullet on
// the field is the build's own.
//
// THE WORLD IS EMPTY. `startPosed` clears the four rosters — so the bullet counted
// afterwards can only be the one this press made — shuts the wave's three gates,
// and leaves the ship with no fire cooldown and no fire lockout, which are the two
// things `specs/ship.md` says would otherwise block a shot. Nothing here poses a
// drone: a shot needs no target.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  playerBullets,
  startPosed,
  type Harness,
} from "../harness";

/** What the field holds before the press, and what one press must add to it. */
const BULLETS_BEFORE = 0;
const BULLETS_AFTER = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts one of the player's bullets on the field when Space is pressed", async () => {
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
  assertLength(
    playerBullets(before),
    BULLETS_BEFORE,
    "the field holds none of the player's bullets before the press",
  );

  await h.tap("Space");
  await captureStill(h, "fired");

  assertLength(
    playerBullets(await h.snapshot()),
    BULLETS_AFTER,
    "Space put one friendly bullet on the field",
  );
});
