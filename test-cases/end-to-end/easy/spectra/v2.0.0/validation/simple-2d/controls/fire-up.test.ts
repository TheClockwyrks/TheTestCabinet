// Spectra — controls/fire-up: holding `ArrowUp` in a live wave fires.
//
// THE RULE. `specs/controls.md` binds the `a` action — "Fires." — to `Space`,
// `ArrowUp` and `KeyW`, and lists `a` among the actions the `inWave` screen reads.
// `specs/ship.md` says a shot is one of the player's bullets, leaving the ship's
// nose. This point decides one third of that binding: that the physical key
// `ArrowUp` is one of the keys which fires. `controls/fire-space` and `controls/fire-w` decide the other two, so a
// build that wired some and not all loses exactly the points it missed.
//
// ONE KEY, TWO ACTIONS, AND THE SCREEN DECIDES. `ArrowUp` drives `a` and `up`, and
// `specs/controls.md` settles the collision with its table of what each screen
// reads: the `inWave` screen reads `a` and does not read `up`. Both actions are
// registered against the key and the build reads both every frame, so the key
// really does raise the ambiguity — pressing it rather than raising an action is
// what puts that in front of the build, and a live wave is where the `a` reading
// has to win. `controls/menu-up-arrow` decides the same key's other reading on the
// title.
//
// WHAT IS ASSERTED, AND WHAT IS NOT. That the key put at least one of the player's
// bullets on a field that held none. Where that bullet appears, how fast it climbs,
// what band it carries, and what the cadence, the cap and the lockout do to a
// second shot are each graded once in the `ship` category — `ship/fire-cadence`
// owns `FIRE_INTERVAL` and `ship/fire-cap` owns `MAX_PLAYER_BULLETS` — so the
// count below is a floor rather than an equality: a build firing at the stated
// cadence takes a second shot inside the window and must not lose this point for
// obeying its own specification.
//
// THE KEY IS HELD, NOT TAPPED. `specs/controls.md` reads `a` as a HOLD, so a
// conforming build resolves it through the engine's `value` rather than its
// `pressed` (the engine's own `engine/input.md`). A key pressed and released
// inside one frame leaves the action at rest for the whole of that frame's update,
// and no conforming build would fire from it, so the key goes down and stays down
// for the window below — which is what a player pressing it does.
//
// THE KEY IS A REAL ONE, AND THE BINDING IS THE CASE'S. Under this engine input
// reaches the game as named actions: the build registers `ACTIONS` against the keys
// `BINDINGS` gives them, and the engine owns the listening and the resolving
// (`specs/controls.md`). `holdFor` dispatches a `KeyboardEvent`-shaped event at the
// engine's own event target, which the engine resolves exactly as it resolves a
// player's key, so the whole path from a physical key to a bullet on the field —
// the registration included — is exercised. The code below is the LITERAL
// `specs/controls.md` states rather than `BINDINGS.a[…]`: that table is the build's
// own copy of the very thing this point decides, and reading it would let a build
// which bound the wrong key agree with itself and pass.
//
// THE WORLD IS EMPTY. `startPosed` clears the four rosters — so the bullets counted
// afterwards can only be the ones this key fired — shuts the wave's three gates, and
// leaves the ship with no fire cooldown and no fire lockout, which are two of the
// three things `specs/ship.md` says would otherwise block a shot; the third, the
// cap, cannot bind on an empty field. Nothing here poses a drone: a shot needs no
// target.

import { afterEach, beforeEach, it } from "vitest";
import { FIRE_INTERVAL } from "../../src/constants";
import { assertEqual, assertGreaterThanOrEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  holdFor,
  playerBullets,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/** The key `specs/controls.md` binds the `a` action to, written out as it states it. */
const KEY = "ArrowUp";

/** What the field holds before the key goes down. */
const BULLETS_BEFORE = 0;

/** How many shots the window must hold for this key to count as wired. */
const MIN_SHOTS = 1;

/**
 * Frames the key is held down.
 *
 * `specs/ship.md` allows a shot whenever the cadence, the cap and the lockout do,
 * and `startPosed` leaves all three clear, so a conforming build fires on the first
 * frame it reads the key down. A build that instead waits out a whole cadence tick
 * still fires inside `FIRE_INTERVAL` (`0.16`), and two frames of slack cover the
 * frame the key-down itself is delivered on. It is a ceiling on the build's
 * latency, not a rate: what is read afterwards is a count, not a spacing.
 */
const HOLD_TICKS = ticksFor(FIRE_INTERVAL) + 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts one of the player's bullets on the field when the Up arrow is held", async () => {
  startPosed(h);
  const before = h.snapshot();
  assertEqual(before.screen, "inWave", "the wave the key is held in is live");
  assertEqual(
    before.phase,
    "live",
    "and the ship is flying rather than respawning",
  );
  assertLength(
    playerBullets(before),
    BULLETS_BEFORE,
    "the player's bullets on the field before the key went down",
  );

  await holdFor(h, KEY, HOLD_TICKS);
  // Before the assertion, so a check that fails still leaves the picture of the
  // field the key was held over.
  captureStill(h, "fired");

  assertGreaterThanOrEqual(
    playerBullets(h.snapshot()).length,
    MIN_SHOTS,
    `the player's bullets on the field after the Up arrow was held for ` +
      `${String(HOLD_TICKS)} frames, the cooldown, the cap and the lockout all ` +
      "clear (specs/controls.md, specs/ship.md)",
  );
});
