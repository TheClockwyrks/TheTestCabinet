// Spectra — controls/fire-autorepeats: fire held for a second fires more than once.
//
// THE RULE. `specs/controls.md` reads `a` as a HOLD rather than a press edge: "a
// held `a` fires every `FIRE_INTERVAL` for as long as the cooldown, the cap, and the
// lockout allow a shot". `specs/ship.md` says the same from the cannon's side:
// "Holding the fire action repeats it at the cadence". This point decides the
// qualitative half of that — that holding the key repeats the shot at all, rather
// than firing once and going quiet until the key is lifted and pressed again.
//
// WHY THE HOLD IS THE WHOLE SCENARIO. Under this engine the two readings are two
// different calls on the engine's input: `value`, which is non-zero for every frame
// the key is down, and `pressed`, which is true once per armed edge and consumed by
// the call that sees it (the engine's own `engine/input.md`). A build that read the
// fire action through `pressed` passes `controls/fire-space` — one press, one
// bullet — and must fail this. So the key really is held down across the whole
// second, and the engine really does report it held on every one of those frames.
//
// THE CADENCE ITSELF IS NOT ASSERTED HERE. `FIRE_INTERVAL` is graded once, by
// `ship/fire-cadence`, and `MAX_PLAYER_BULLETS` by `ship/fire-cap`; a check that
// demanded the whole `1 / FIRE_INTERVAL` count over the second would be grading both
// of those a second time, and would fail a build whose repeat is real but whose
// spacing is wrong. What is required here is exactly what the point claims: MORE
// THAN ONE shot over the held second.
//
// HOW THE SHOTS ARE COUNTED, AND WHY NOT BY IDENTITY. The roster does not simply
// grow: `specs/ship.md` caps the player's bullets in flight at `MAX_PLAYER_BULLETS`
// (`3`) and a bullet leaving the top of the field leaves the roster, so the count
// over a second rises and falls. What is counted instead is every frame-to-frame
// INCREASE in the number of the player's bullets, summed — each increase is a shot
// that was taken, whatever left the roster before it. Identity is deliberately not
// used: `specs/instrumentation.md` promises only that an id is unique among the
// entities ALIVE at a moment and kept for an entity's whole life, so a build that
// hands a dead bullet's id to a new one is conformant and would defeat a count of
// distinct ids. Sampling every frame is what makes the sum right: `FIRE_INTERVAL`
// (`0.16` s) is 19.2 frames of this harness's 120 Hz clock, so no two shots can hide
// inside one sample. A shot that lands on the same frame as an expiry nets zero and
// is undercounted, which can only make this check more forgiving, never falsely
// passing.
//
// THE WORLD IS EMPTY. `startPosed` clears the four rosters, shuts the wave's three
// gates and leaves no cooldown and no lockout standing, so every bullet counted over
// the second is one this key fired.

import { afterEach, beforeEach, it } from "vitest";
import { FIRE_INTERVAL } from "../../src/constants";
import { assertEqual, assertGreaterThanOrEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  playerBullets,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * The keys held: ALL THREE `specs/controls.md` binds the `a` action to, written out
 * as it states them rather than read off the build's `BINDINGS`.
 *
 * All three, and not one of them, because WHICH keys fire is decided elsewhere —
 * `controls/fire-space`, `controls/fire-up` and `controls/fire-w` own one binding
 * each. Holding a single key here would fail a build that wired the other two on a
 * point that is only about what a HELD fire action does, charging one fault twice.
 * With all three down the action is held for any build that bound any of them, so
 * what this point reads is the repeat and nothing else.
 *
 * Holding three keys at once is safe on this screen and costs the reading nothing.
 * `ArrowUp` and `KeyW` also drive `up` and `Space` also drives `confirm`, and
 * `specs/controls.md`'s table gives the `inWave` screen neither.
 */
const FIRE_KEYS = ["Space", "ArrowUp", "KeyW"] as const;

/** How long it is held: the second the point's own wording names. */
const HOLD_SECONDS = 1.0;
const HOLD_TICKS = ticksFor(HOLD_SECONDS);

/**
 * How many shots the held second must produce.
 *
 * TWO — "more than one", the point's own claim, and nothing beyond it. What
 * `specs/ship.md` states would give a conformant build far more (`FIRE_INTERVAL` is
 * `0.16` s, so six shots' worth of cadence inside the second, throttled by the
 * three-bullet cap), and this bound sits well under that on purpose: the figure is
 * `ship/fire-cadence`'s point, and a build whose repeat is slower than stated should
 * lose that point rather than this one.
 */
const MIN_SHOTS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("fires more than once over a second of held fire", async () => {
  startPosed(h);
  const before = h.snapshot();
  assertEqual(before.screen, "inWave", "the wave the key is held in is live");
  assertLength(
    playerBullets(before),
    0,
    "the player's bullets on the field before the hold",
  );

  let shots = 0;
  let inFlight = 0;
  for (const key of FIRE_KEYS) h.hold(key);
  try {
    for (let tick = 0; tick < HOLD_TICKS; tick += 1) {
      await h.advance(1);
      const now = playerBullets(h.snapshot()).length;
      if (now > inFlight) shots += now - inFlight;
      inFlight = now;
    }
  } finally {
    for (const key of FIRE_KEYS) h.release(key);
  }
  // Before the assertion, so a check that fails still leaves the picture of the
  // field the held second produced.
  captureStill(h, "repeat");

  assertGreaterThanOrEqual(
    shots,
    MIN_SHOTS,
    `shots taken over ${String(HOLD_SECONDS)}s of held fire, counted as every ` +
      "frame-to-frame rise in the player's bullets — specs/controls.md reads `a` " +
      `as a hold, firing every ${String(FIRE_INTERVAL)}s while the cooldown, the ` +
      "cap and the lockout allow",
  );
});
